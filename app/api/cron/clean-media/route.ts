import { NextResponse } from "next/server";
import { purgeAssets, type PurgeOutcome, type PurgeTarget } from "@/lib/storage/purge";
import { removeStorageObjects } from "@/lib/storage/remove";
import { ORPHAN_MIN_AGE_HOURS, STALE_PENDING_HOURS, TRASH_RETENTION_DAYS } from "@/lib/storage/retention";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * GET|POST /api/cron/clean-media — the nightly media cleanup.
 *
 * Called once a day by the same external scheduler as the other crons, with
 * the same `Authorization: Bearer <CRON_SECRET>` (docs/environment.md). Each
 * run, in batches:
 *
 *   a) photos deleted more than TRASH_RETENTION_DAYS ago are deleted for good —
 *      every file, the row, its album links, the CDN's copies — unless a live
 *      board or a screen's bundle still names them. Those are kept, and listed
 *      in the report with the boards that name them. Albums deleted that long
 *      ago go too.
 *   b) uploads that failed, and ones still 'pending' after STALE_PENDING_HOURS
 *      (their tab closed mid-upload), are deleted the same way.
 *   c) files in the bucket that no photo row claims at all, older than
 *      ORPHAN_MIN_AGE_HOURS, are removed.
 *
 * DRY RUN BY DEFAULT. Nothing is deleted unless MEDIA_CLEANUP_DRY_RUN is set to
 * exactly `false`; until then every run reports what it would have done. A
 * job that permanently deletes a shul's photos earns a look at its first
 * reports before it's let loose.
 *
 * WHY THE SERVICE-ROLE KEY. It sweeps every shul's trash and the whole bucket
 * at once — a cross-tenant read and delete no RLS policy expresses, the same
 * reason the build and warming crons hold it. The hard delete itself is
 * lib/storage/purge.ts, which "Delete permanently" in Media also calls under
 * the editor's own session.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Photos (and files, for the orphan sweep) handled per step per run. A
 *  backlog clears over several nights rather than blowing the time budget. */
const BATCH = 200;

type Summary = {
  dryRun: boolean;
  retentionDays: number;
  trash: PurgeOutcome & {
    /** Due, but a live board or a screen's bundle still names them. */
    kept: { assetId: string; orgId: string; deletedAt: string; boards: { id: string; name: string }[]; inBundle: boolean }[];
    albums: number;
  };
  failedUploads: PurgeOutcome;
  abandonedUploads: PurgeOutcome;
  orphans: { found: number; removed: number; failed: number };
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

async function handle(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  const db = serviceClientOrNull();
  if (!db) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const dryRun = process.env.MEDIA_CLEANUP_DRY_RUN !== "false";
  const targets = async (ids: string[]): Promise<PurgeTarget[]> => {
    if (ids.length === 0) return [];
    const { data } = await db.from("assets").select("id, org_id, storage_bucket, variants").in("id", ids);
    return data ?? [];
  };

  // a) The trash.
  const { data: candidates, error: candidatesError } = await db.rpc("media_purge_candidates", {
    p_retention_days: TRASH_RETENTION_DAYS,
    p_limit: BATCH,
  });
  if (candidatesError) return NextResponse.json({ error: candidatesError.message }, { status: 502 });
  const due = (candidates ?? []).filter((row) => !row.referenced).map((row) => row.asset_id);
  const trash = await purgeAssets(db, await targets(due), { dryRun });
  const kept = (candidates ?? [])
    .filter((row) => row.referenced)
    .map((row) => ({
      assetId: row.asset_id,
      orgId: row.org_id,
      deletedAt: row.deleted_at,
      boards: (row.boards as { id: string; name: string }[] | null) ?? [],
      inBundle: row.in_bundle,
    }));

  const cutoff = hoursAgo(TRASH_RETENTION_DAYS * 24);
  const { data: oldAlbums } = await db
    .from("albums")
    .select("id")
    .not("deleted_at", "is", null)
    .lt("deleted_at", cutoff)
    .limit(BATCH);
  let albums = oldAlbums?.length ?? 0;
  if (!dryRun && albums > 0) {
    const { data: gone } = await db
      .from("albums")
      .delete()
      .in("id", (oldAlbums ?? []).map((album) => album.id))
      .not("deleted_at", "is", null)
      .select("id");
    albums = gone?.length ?? 0;
  }

  // b) Uploads that never finished.
  const { data: failedRows } = await db.from("assets").select("id").eq("status", "failed").limit(BATCH);
  const failedUploads = await purgeAssets(db, await targets((failedRows ?? []).map((row) => row.id)), { dryRun });
  const { data: stale } = await db
    .from("assets")
    .select("id")
    .eq("status", "pending")
    .lt("created_at", hoursAgo(STALE_PENDING_HOURS))
    .limit(BATCH);
  const abandonedUploads = await purgeAssets(db, await targets((stale ?? []).map((row) => row.id)), { dryRun });

  // c) Files nothing claims.
  const { data: orphanRows } = await db.rpc("media_orphan_objects", {
    p_min_age_hours: ORPHAN_MIN_AGE_HOURS,
    p_limit: BATCH * 5,
  });
  const orphanPaths = (orphanRows ?? []).map((row) => row.name);
  const removed = dryRun ? { removed: 0, failed: [] } : await removeStorageObjects(db, "assets", orphanPaths);

  const summary: Summary = {
    dryRun,
    retentionDays: TRASH_RETENTION_DAYS,
    trash: { ...trash, kept, albums },
    failedUploads,
    abandonedUploads,
    orphans: { found: orphanPaths.length, removed: removed.removed, failed: removed.failed.length },
  };
  console.info(
    `[clean-media] ${dryRun ? "dry run: would delete" : "deleted"} ${trash.purged.length} trashed photos (${trash.files} files), ` +
      `${albums} albums, ${failedUploads.purged.length} failed and ${abandonedUploads.purged.length} abandoned uploads, ` +
      `${dryRun ? orphanPaths.length : removed.removed} orphan files; kept ${kept.length} still on a board; ` +
      `${trash.failed.length + failedUploads.failed.length + abandonedUploads.failed.length} couldn't be deleted`,
  );
  return NextResponse.json(summary);
}

export const GET = handle;
export const POST = handle;
