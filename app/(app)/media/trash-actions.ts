"use server";

import { revalidatePath } from "next/cache";
import { hasRoleAtLeast, requireActiveOrg } from "@/lib/orgs";
import { purgeAssets } from "@/lib/storage/purge";
import { createClient } from "@/lib/supabase/server";

/*
 * Media's "Recently deleted": putting photos and albums back, or deleting
 * photos for good before the 30 days are up (lib/storage/retention.ts).
 *
 * All of it runs under the editor's own session, so RLS decides what it may
 * touch — no service key. "Delete permanently" is lib/storage/purge.ts, the
 * same path the nightly cleanup takes.
 *
 * A deleted photo keeps its album links on purpose (app/(app)/media/actions.ts
 * only sets deleted_at), which is what lets restoring it put it back where it
 * was. Deleting an album soft-deletes the album and, at the same instant, the
 * photos only it held — so restoring the album restores exactly the photos
 * whose deleted_at matches its own.
 */

export type RestoreResult =
  | { ok: true; restored: number; conflicts: string[]; albumsRestored: string[] }
  | { ok: false; error: string };

const MAX_BATCH = 500;
const CHUNK = 150;

async function editorOrg() {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "editor")) return null;
  return org;
}

const NO_ACCESS = "You need editor access to change media.";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Clear deleted_at on each photo, one at a time so one failure doesn't take
 * the rest with it. The checksum index allows one live copy of a file per
 * shul (20260927090000): if the same photo was uploaded again after this one
 * was deleted, bringing this one back would make two, and Postgres refuses.
 */
async function undelete(
  supabase: Supabase,
  orgId: string,
  photos: { id: string; name: string }[],
): Promise<{ restored: string[]; conflicts: string[]; error: string | null }> {
  const restored: string[] = [];
  const conflicts: string[] = [];
  for (const photo of photos) {
    const { error } = await supabase
      .from("assets")
      .update({ deleted_at: null })
      .eq("id", photo.id)
      .eq("org_id", orgId)
      .not("deleted_at", "is", null);
    if (!error) restored.push(photo.id);
    else if (error.code === "23505") conflicts.push(photo.name);
    else return { restored, conflicts, error: error.message };
  }
  return { restored, conflicts, error: null };
}

export async function restorePhotos(assetIds: string[]): Promise<RestoreResult> {
  if (assetIds.length === 0) return { ok: true, restored: 0, conflicts: [], albumsRestored: [] };
  if (assetIds.length > MAX_BATCH) return { ok: false, error: `Restore at most ${MAX_BATCH} photos at a time.` };
  const org = await editorOrg();
  if (!org) return { ok: false, error: NO_ACCESS };

  const supabase = await createClient();
  const photos: { id: string; name: string }[] = [];
  for (let at = 0; at < assetIds.length; at += CHUNK) {
    const { data, error } = await supabase
      .from("assets")
      .select("id, original_filename")
      .in("id", assetIds.slice(at, at + CHUNK))
      .eq("org_id", org.orgId)
      .not("deleted_at", "is", null);
    if (error) return { ok: false, error: `Couldn't restore the photos: ${error.message}` };
    for (const row of data ?? []) photos.push({ id: row.id, name: row.original_filename ?? "A photo" });
  }

  const { restored, conflicts, error } = await undelete(supabase, org.orgId, photos);
  if (error) return { ok: false, error: `Couldn't restore the photos: ${error}` };

  // A photo whose every album is deleted would come back somewhere Media
  // can't show it. Bring its most recently deleted album back with it — the
  // album only, not the other photos that were in it.
  const albumsRestored = new Set<string>();
  for (let at = 0; at < restored.length; at += CHUNK) {
    const { data: links } = await supabase
      .from("album_items")
      .select("asset_id, albums(id, name, deleted_at)")
      .in("asset_id", restored.slice(at, at + CHUNK))
      .eq("org_id", org.orgId);
    const byPhoto = new Map<string, { id: string; name: string; deleted_at: string | null }[]>();
    for (const link of links ?? []) {
      const album = link.albums as unknown as { id: string; name: string; deleted_at: string | null } | null;
      if (!album) continue;
      byPhoto.set(link.asset_id, [...(byPhoto.get(link.asset_id) ?? []), album]);
    }
    for (const albums of byPhoto.values()) {
      if (albums.some((album) => !album.deleted_at)) continue;
      const latest = [...albums].sort((a, b) => Date.parse(b.deleted_at!) - Date.parse(a.deleted_at!))[0];
      if (!latest || albumsRestored.has(latest.name)) continue;
      const { error: albumError } = await supabase
        .from("albums")
        .update({ deleted_at: null })
        .eq("id", latest.id)
        .eq("org_id", org.orgId);
      if (!albumError) albumsRestored.add(latest.name);
    }
  }

  revalidatePath("/media", "layout");
  return { ok: true, restored: restored.length, conflicts, albumsRestored: [...albumsRestored] };
}

/** Bring back a deleted album, and the photos that were deleted with it. */
export async function restoreAlbum(albumId: string): Promise<RestoreResult> {
  const org = await editorOrg();
  if (!org) return { ok: false, error: NO_ACCESS };

  const supabase = await createClient();
  const { data: album, error: albumError } = await supabase
    .from("albums")
    .select("id, name, deleted_at")
    .eq("id", albumId)
    .eq("org_id", org.orgId)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (albumError) return { ok: false, error: `Couldn't restore the album: ${albumError.message}` };
  if (!album?.deleted_at) return { ok: false, error: "That album isn't in Recently deleted any more." };

  // Its photos deleted in the same moment it was — deleteAlbum stamps both
  // with one timestamp. A photo deleted on its own before or after stays
  // where it is.
  const { data: links } = await supabase
    .from("album_items")
    .select("asset_id, assets(id, original_filename, deleted_at)")
    .eq("album_id", albumId)
    .eq("org_id", org.orgId);
  const deletedWith: { id: string; name: string }[] = [];
  const stamp = Date.parse(album.deleted_at);
  for (const link of links ?? []) {
    const asset = link.assets as unknown as { id: string; original_filename: string | null; deleted_at: string | null } | null;
    if (asset?.deleted_at && Date.parse(asset.deleted_at) === stamp) {
      deletedWith.push({ id: asset.id, name: asset.original_filename ?? "A photo" });
    }
  }

  const { error } = await supabase
    .from("albums")
    .update({ deleted_at: null })
    .eq("id", albumId)
    .eq("org_id", org.orgId);
  if (error) return { ok: false, error: `Couldn't restore the album: ${error.message}` };

  const photos = await undelete(supabase, org.orgId, deletedWith);
  if (photos.error) return { ok: false, error: `The album is back, but its photos couldn't be restored: ${photos.error}` };

  revalidatePath("/media", "layout");
  return { ok: true, restored: photos.restored.length, conflicts: photos.conflicts, albumsRestored: [album.name] };
}

/**
 * Delete photos for good, now: every file, the rows, and the CDN's copies —
 * lib/storage/purge.ts, the nightly cleanup's own path. Only photos already in
 * Recently deleted; a live photo has to be deleted first.
 */
export async function deletePhotosPermanently(
  assetIds: string[],
): Promise<{ ok: true; deleted: number; failed: number } | { ok: false; error: string }> {
  if (assetIds.length === 0) return { ok: true, deleted: 0, failed: 0 };
  if (assetIds.length > MAX_BATCH) return { ok: false, error: `Delete at most ${MAX_BATCH} photos at a time.` };
  const org = await editorOrg();
  if (!org) return { ok: false, error: NO_ACCESS };

  const supabase = await createClient();
  const targets = [];
  for (let at = 0; at < assetIds.length; at += CHUNK) {
    const { data, error } = await supabase
      .from("assets")
      .select("id, org_id, storage_bucket, variants")
      .in("id", assetIds.slice(at, at + CHUNK))
      .eq("org_id", org.orgId)
      .not("deleted_at", "is", null);
    if (error) return { ok: false, error: `Couldn't delete the photos: ${error.message}` };
    targets.push(...(data ?? []));
  }

  const outcome = await purgeAssets(supabase, targets, { dryRun: false });
  revalidatePath("/media", "layout");
  return { ok: true, deleted: outcome.purged.length, failed: outcome.failed.length };
}
