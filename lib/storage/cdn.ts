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

/**
 * Drop every CDN copy of these photos' files now. Deleted, not marked stale:
 * a stale copy would be served once more while the CDN checked back.
 * Returns whether the purge was accepted.
 */
export async function purgeAssetsFromCdn(assetIds: readonly string[]): Promise<boolean> {
  if (assetIds.length === 0) return true;
  try {
    await dangerouslyDeleteByTag(assetIds.map(assetCacheTag));
    return true;
  } catch {
    return false;
  }
}
