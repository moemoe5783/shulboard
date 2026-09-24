import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readAssetVariant } from "@/lib/bundle/media";
import { purgeAssetsFromCdn } from "./cdn";
import { removeStorageObjects } from "./remove";

/*
 * Permanently deleting photos: every file, the rows, and the CDN's copies.
 *
 * THE ONE HARD-DELETE PATH. The nightly cleanup job (app/api/cron/clean-media,
 * service role) and Media's "Delete permanently" button (the editor's own
 * session, so Storage and table RLS decide what it may touch) both come
 * through here, so the two can't disagree about what "gone" means.
 *
 * ORDER: files first, rows second. A photo whose files couldn't all be removed
 * keeps its row, so the next run finds it and tries again; the other way round
 * would leave files with no row pointing at them. (The orphan sweep catches
 * those too, but it shouldn't have to.)
 *
 * Which files: every size the row lists AND whatever else is in the photo's
 * folder — a failed or abandoned upload can leave sizes the row never
 * recorded.
 *
 * Callers pass only rows that are due: soft-deleted, failed, or abandoned.
 * The delete triggers skip rebuilds for exactly those
 * (20260927090300_media_cleanup.sql), because no screen shows them.
 */

export type PurgeTarget = {
  id: string;
  org_id: string;
  storage_bucket: string;
  variants: unknown;
};

export type PurgeOutcome = {
  /** Photos whose files and rows are gone (or would be, on a dry run). */
  purged: string[];
  /** Files removed (or found, on a dry run). */
  files: number;
  /** Photos kept because a file or the row wouldn't delete; tried next run. */
  failed: { id: string; reason: string }[];
  /** Whether Vercel accepted the CDN purge; true when there was nothing to purge. */
  cdnPurged: boolean;
};

/** Everything in a photo's folder, plus every path its row names. */
async function filesOf(db: SupabaseClient<Database>, asset: PurgeTarget): Promise<string[] | null> {
  const folder = `${asset.org_id}/${asset.id}`;
  const paths = new Set<string>();
  if (asset.variants && typeof asset.variants === "object") {
    for (const name of Object.keys(asset.variants)) {
      const variant = readAssetVariant(asset.variants, name);
      if (variant) paths.add(variant.storagePath);
    }
  }
  const { data, error } = await db.storage.from(asset.storage_bucket).list(folder, { limit: 1000 });
  if (error) return null;
  for (const entry of data ?? []) {
    // A folder listing's entries with no id are sub-folders; photos have none.
    if (entry.id) paths.add(`${folder}/${entry.name}`);
  }
  return [...paths];
}

export async function purgeAssets(
  db: SupabaseClient<Database>,
  targets: readonly PurgeTarget[],
  options: { dryRun: boolean },
): Promise<PurgeOutcome> {
  const outcome: PurgeOutcome = { purged: [], files: 0, failed: [], cdnPurged: true };
  const clear: string[] = [];

  for (const asset of targets) {
    const paths = await filesOf(db, asset);
    if (!paths) {
      outcome.failed.push({ id: asset.id, reason: "couldn't list its files" });
      continue;
    }
    if (options.dryRun) {
      outcome.files += paths.length;
      outcome.purged.push(asset.id);
      continue;
    }
    const removed = await removeStorageObjects(db, asset.storage_bucket, paths);
    outcome.files += removed.removed;
    if (removed.failed.length > 0) {
      outcome.failed.push({ id: asset.id, reason: `${removed.failed.length} file(s) wouldn't delete` });
      continue;
    }
    clear.push(asset.id);
  }

  if (options.dryRun || clear.length === 0) return outcome;

  // Its album links first (the FK would cascade anyway; doing it here keeps
  // the delete a single, predictable pair of statements per batch), then the
  // rows.
  const CHUNK = 150;
  for (let at = 0; at < clear.length; at += CHUNK) {
    const ids = clear.slice(at, at + CHUNK);
    const { error: linksError } = await db.from("album_items").delete().in("asset_id", ids);
    const { data: deleted, error } = linksError
      ? { data: null, error: linksError }
      : await db.from("assets").delete().in("id", ids).select("id");
    if (error) {
      for (const id of ids) outcome.failed.push({ id, reason: error.message });
      continue;
    }
    const gone = new Set((deleted ?? []).map((row) => row.id));
    for (const id of ids) {
      if (gone.has(id)) outcome.purged.push(id);
      else outcome.failed.push({ id, reason: "the row wouldn't delete" });
    }
  }

  // Files are gone and the proxy 404s now; drop the CDN's year-long copies too
  // (lib/storage/cdn.ts).
  outcome.cdnPurged = await purgeAssetsFromCdn(outcome.purged);
  return outcome;
}
