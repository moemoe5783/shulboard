import Link from "next/link";
import { readBestVariant } from "@/lib/bundle/media";
import { hasRoleAtLeast, requireActiveOrg } from "@/lib/orgs";
import { daysUntilPermanentDeletion, TRASH_RETENTION_DAYS } from "@/lib/storage/retention";
import { createClient } from "@/lib/supabase/server";
import { RecentlyDeleted, type DeletedAlbum, type DeletedPhoto } from "./RecentlyDeleted";

/*
 * Media → Recently deleted: photos and albums deleted in the last
 * TRASH_RETENTION_DAYS days, which can be put back until the nightly cleanup
 * deletes them for good (app/api/cron/clean-media).
 *
 * THUMBNAILS ARE SIGNED URLS, and only here. The /m proxy answers 404 for a
 * deleted photo — that's what takes it off every board — so the grid's usual
 * paths can't show one. A short-lived signed URL under the editor's own
 * session (Storage RLS: members of the shul) can. The "never a signed URL"
 * rule (lib/bundle/media.ts) is about bundles, which are stored and outlive
 * any expiry; this page is rendered fresh each visit.
 */

export const dynamic = "force-dynamic";

const LIMIT = 500;
const THUMB_TTL_SECONDS = 60 * 60;

/** Everything in this shul's Recently deleted, ready to show. Outside the
 *  component so the countdown can read the clock. */
async function loadTrash(orgId: string, timezone: string): Promise<{ photos: DeletedPhoto[]; albums: DeletedAlbum[] }> {
  const supabase = await createClient();
  const now = Date.now();
  const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: timezone });

  const [{ data: albumRows, error: albumsError }, { data: assetRows, error: assetsError }] = await Promise.all([
    supabase
      .from("albums")
      .select("id, name, deleted_at")
      .eq("org_id", orgId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("assets")
      .select("id, original_filename, deleted_at, variants")
      .eq("org_id", orgId)
      .eq("status", "ready")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(LIMIT),
  ]);
  if (albumsError) throw new Error(`Couldn't load deleted albums: ${albumsError.message}`);
  if (assetsError) throw new Error(`Couldn't load deleted photos: ${assetsError.message}`);

  // One signing request for every thumbnail on the page.
  const thumbPaths = new Map<string, string>();
  for (const row of assetRows ?? []) {
    const thumb = readBestVariant(row.variants, "thumb");
    if (thumb) thumbPaths.set(row.id, thumb.variant.storagePath);
  }
  const signed = new Map<string, string>();
  if (thumbPaths.size > 0) {
    const { data } = await supabase.storage.from("assets").createSignedUrls([...thumbPaths.values()], THUMB_TTL_SECONDS);
    for (const entry of data ?? []) if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }

  // Which album each photo was in, for the line under its name.
  const albumOf = new Map<string, string>();
  const ids = (assetRows ?? []).map((row) => row.id);
  for (let at = 0; at < ids.length; at += 150) {
    const { data: links } = await supabase
      .from("album_items")
      .select("asset_id, albums(name)")
      .in("asset_id", ids.slice(at, at + 150))
      .eq("org_id", orgId);
    for (const link of links ?? []) {
      const name = (link.albums as unknown as { name: string } | null)?.name;
      if (name && !albumOf.has(link.asset_id)) albumOf.set(link.asset_id, name);
    }
  }

  const photos: DeletedPhoto[] = (assetRows ?? []).map((row) => ({
    id: row.id,
    name: row.original_filename ?? "Untitled photo",
    album: albumOf.get(row.id) ?? null,
    thumbUrl: signed.get(thumbPaths.get(row.id) ?? "") ?? null,
    deletedOn: day.format(new Date(row.deleted_at!)),
    daysLeft: daysUntilPermanentDeletion(row.deleted_at!, now),
  }));
  const albums: DeletedAlbum[] = (albumRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    deletedOn: day.format(new Date(row.deleted_at!)),
    daysLeft: daysUntilPermanentDeletion(row.deleted_at!, now),
  }));

  return { photos, albums };
}

export default async function RecentlyDeletedPage() {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "editor")) {
    return (
      <>
        <h1 className="text-title">Recently deleted</h1>
        <p className="text-body text-ink-soft mt-1">You need editor access to restore or delete photos.</p>
        <Link href="/media" className="text-body text-verdigris mt-4 inline-block">
          Back to Media
        </Link>
      </>
    );
  }

  const { photos, albums } = await loadTrash(org.orgId, org.timezone);
  return <RecentlyDeleted photos={photos} albums={albums} retentionDays={TRASH_RETENTION_DAYS} />;
}
