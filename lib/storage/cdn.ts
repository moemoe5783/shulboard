import "server-only";

import { addCacheTag, dangerouslyDeleteByTag } from "@vercel/functions";

/*
 * Vercel's CDN copy of a photo's files — tagging them as they're served, and
 * purging them when the photo is permanently deleted.
 *
 * The /m proxy (app/m/[id]/[file]/route.ts) tells the CDN to keep every file
 * for a year: its path carries the file's content hash, so a given URL names
 * one set of bytes forever. What that can't cover is deletion — a deleted
 * photo's URL would keep answering from the edge. Every size of a photo is
 * tagged with the photo's id, so the permanent delete (lib/storage/purge.ts)
 * clears them all in one call.
 *
 * Both calls go through the Vercel request context and do nothing anywhere
 * else (local `next start`, tests) — nothing to switch off outside Vercel.
 * Neither ever throws: a failed tag or purge costs a cached copy, not the
 * response or the delete.
 */

export const assetCacheTag = (assetId: string) => `asset-${assetId}`;

/** Tag the response being built with this photo's id. */
export async function tagAssetResponse(assetId: string): Promise<void> {
  try {
    await addCacheTag(assetCacheTag(assetId));
  } catch {
    // Untagged, it still caches; it just can't be purged by id.
  }
}

/** Tags per purge call — a bulk delete of hundreds of photos goes in batches. */
const PURGE_BATCH = 100;

/**
 * Drop every CDN copy of these photos' files now. Deleted, not marked stale:
 * a stale copy would be served once more while the CDN checked back.
 *
 * Called on a soft delete (so a deleted photo's URL is a 404 at once rather
 * than answering from the edge for a year) and on a permanent delete. A
 * restore needs none: the proxy serves the photo again and the next request
 * caches it afresh.
 *
 * Never fails the delete it follows: a batch the CDN refuses is logged as a
 * warning, and returns false. The photo is still gone from every board — the
 * bundle and the proxy both refuse it — and its URL carries an unguessable
 * content hash.
 */
export async function purgeAssetsFromCdn(assetIds: readonly string[]): Promise<boolean> {
  let ok = true;
  for (let at = 0; at < assetIds.length; at += PURGE_BATCH) {
    const batch = assetIds.slice(at, at + PURGE_BATCH);
    try {
      await dangerouslyDeleteByTag(batch.map(assetCacheTag));
    } catch (error) {
      ok = false;
      console.warn(
        `[cdn] couldn't purge ${batch.length} photo(s) from the CDN; their old URLs may answer until they expire`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return ok;
}
