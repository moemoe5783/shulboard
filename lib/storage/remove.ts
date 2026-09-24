import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Removing files from Storage — the one copy, shared by the browser upload
 * (cleaning up after itself when an upload fails, under the editor's own
 * session and Storage RLS) and the media cleanup job (service role).
 *
 * Deliberately not `server-only`: the upload runs in the browser. The client
 * passed in decides what it is allowed to remove.
 */

/** Storage's remove() takes a list; this keeps each request a sensible size. */
const REMOVE_CHUNK = 100;

export type RemoveResult = { removed: number; failed: string[] };

/**
 * Remove these paths from a bucket. Never throws: a chunk that fails is
 * reported path by path so the caller can log it, and the cleanup job's
 * orphan sweep picks up anything left behind.
 */
export async function removeStorageObjects(
  supabase: SupabaseClient,
  bucket: string,
  paths: readonly string[],
): Promise<RemoveResult> {
  const unique = [...new Set(paths.filter(Boolean))];
  const result: RemoveResult = { removed: 0, failed: [] };
  for (let at = 0; at < unique.length; at += REMOVE_CHUNK) {
    const chunk = unique.slice(at, at + REMOVE_CHUNK);
    try {
      const { data, error } = await supabase.storage.from(bucket).remove(chunk);
      if (error) {
        result.failed.push(...chunk);
        continue;
      }
      // Storage answers with the objects it actually deleted; a path that was
      // already gone isn't a failure.
      result.removed += data?.length ?? 0;
    } catch {
      result.failed.push(...chunk);
    }
  }
  return result;
}
