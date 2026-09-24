import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { mediaProxyPath, readAssetVariant, readBestVariant } from "@/lib/bundle/media";
import { scaledSize, VARIANT_SPECS } from "./variants";

/*
 * Resolving an album to the photos a board actually shows — the one place that
 * turns album_items + assets rows into `{ src, width, height }`, shared by the
 * bundle builder (server, service role) and the editor preview (browser, RLS)
 * so they can't disagree about what a Gallery or Collage widget will render.
 *
 * The src is a media-proxy path (/m/…), never a signed URL — same rule as every
 * other asset reference (lib/bundle/media.ts): it doesn't expire, so a stored
 * bundle keeps working, and the display serves it from cache offline.
 */

/** The board face embedded for photos — same variant Image uses. */
const DISPLAY_VARIANT = "display";

/** One stored size of a photo. A board picks the smallest that is still sharp
 *  at the size it renders (widgets/collage/Renderer.tsx). */
export type BoardPhotoVariant = {
  name: string;
  src: string;
  width: number;
  height: number;
  contentType: string;
  bytes: number;
};

export type BoardPhoto = {
  assetId: string;
  /** The `display` derivative — what a single-photo widget shows. */
  src: string;
  /** The photo's size after EXIF rotation, as recorded at upload. */
  width: number | null;
  height: number | null;
  caption: string | null;
  /** When it was added to the album — what "newest first" sorts by. */
  addedAt: string | null;
  /** The last date (shul time) boards show it, or null for no end —
   *  album_items.display_until. Resolved on the device against its own clock
   *  (lib/media/visibility.ts), so a screen offline still drops it on time. */
  displayUntil: string | null;
  /** Every stored size, smallest first. Empty if the photo has no size on
   *  record (the album page backfills those — app/(app)/media/actions.ts). */
  variants: BoardPhotoVariant[];
};

/** Albums resolved to their ordered, ready photos, keyed by album id. */
export type BoardAlbums = Record<string, BoardPhoto[]>;

type ItemRow = {
  album_id: string;
  caption: string | null;
  created_at: string | null;
  display_until?: string | null;
  assets: {
    id: string;
    variants: unknown;
    width: number | null;
    height: number | null;
    deleted_at: string | null;
    status?: string;
  } | null;
};

/**
 * Fetch the photos for a set of albums, in album order.
 *
 * `orgId` is passed by the service-role caller (the bundle build, which has no
 * RLS to scope it) and omitted by the browser caller (RLS already scopes to the
 * member's org). A soft-deleted or unfinished asset, or one without a
 * display variant, is skipped rather than rendered as a hole.
 */
export async function fetchAlbumPhotos(
  supabase: SupabaseClient<Database>,
  albumIds: string[],
  orgId?: string,
): Promise<BoardAlbums> {
  const albums: BoardAlbums = {};
  if (albumIds.length === 0) return albums;
  // Seed every requested album so a resolved-but-empty album is distinguishable
  // from one that was never resolved (undefined) by the widget.
  for (const id of albumIds) albums[id] = [];

  // A deleted album shows nothing, even if a board still points at it.
  let live = supabase.from("albums").select("id").in("id", albumIds).is("deleted_at", null);
  if (orgId) live = live.eq("org_id", orgId);
  const { data: liveAlbums, error: liveError } = await live;
  if (liveError) return albums;
  const liveIds = (liveAlbums ?? []).map((album) => album.id);
  if (liveIds.length === 0) return albums;

  const read = (columns: string) => {
    let query = supabase
      .from("album_items")
      .select(columns)
      .in("album_id", liveIds)
      .order("position", { ascending: true });
    if (orgId) query = query.eq("org_id", orgId);
    return query;
  };
  const withEndDate = "album_id, caption, created_at, display_until, assets(id, variants, width, height, deleted_at, status)";
  let { data, error } = await read(withEndDate);
  // The end-date column arrived in its own migration
  // (20260924090000_album_items_display_until.sql). On a database that hasn't
  // applied it yet, read without it — every photo then simply has no end date —
  // rather than resolving every album to nothing and blanking every board.
  if (error && (error.code === "42703" || /display_until/.test(error.message))) {
    ({ data, error } = await read(withEndDate.replace(" display_until,", "")));
  }
  if (error) return albums;

  for (const item of (data ?? []) as unknown as ItemRow[]) {
    const asset = item.assets;
    // Only a finished upload: a 'pending' or 'failed' row's files are
    // incomplete or already removed (lib/media/upload.ts).
    if (!asset || asset.deleted_at || asset.status !== "ready") continue;
    const best = readBestVariant(asset.variants, DISPLAY_VARIANT);
    if (!best) continue;
    albums[item.album_id]?.push({
      assetId: asset.id,
      src: mediaProxyPath({
        id: asset.id,
        variant: best.name,
        content_hash: best.variant.contentHash,
        extension: best.variant.extension,
      }),
      width: asset.width,
      height: asset.height,
      caption: item.caption,
      addedAt: item.created_at,
      displayUntil: item.display_until ?? null,
      variants: photoVariants(asset),
    });
  }

  return albums;
}

/**
 * Every stored size of an asset, smallest first. A derivative's own recorded
 * size wins; an older one is sized from the asset's dimensions the same way
 * the pipeline scaled it (lib/media/variants.ts). Without either there is no
 * honest size to give, and the photo is left with none.
 */
function photoVariants(asset: { id: string; variants: unknown; width: number | null; height: number | null }): BoardPhotoVariant[] {
  const out: BoardPhotoVariant[] = [];
  for (const spec of VARIANT_SPECS) {
    const variant = readAssetVariant(asset.variants, spec.name);
    if (!variant) continue;
    const size =
      variant.width && variant.height
        ? { width: variant.width, height: variant.height }
        : asset.width && asset.height
          ? scaledSize(asset.width, asset.height, spec.maxEdge)
          : null;
    if (!size) continue;
    out.push({
      name: spec.name,
      src: mediaProxyPath({ id: asset.id, variant: spec.name, content_hash: variant.contentHash, extension: variant.extension }),
      width: size.width,
      height: size.height,
      contentType: variant.contentType,
      bytes: variant.bytes,
    });
  }
  return out.sort((a, b) => a.width - b.width);
}
