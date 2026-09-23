import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { mediaProxyPath, readAssetVariant } from "@/lib/bundle/media";
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
  display_until: string | null;
  assets: {
    id: string;
    variants: unknown;
    width: number | null;
    height: number | null;
    deleted_at: string | null;
  } | null;
};

/**
 * Fetch the photos for a set of albums, in album order.
 *
 * `orgId` is passed by the service-role caller (the bundle build, which has no
 * RLS to scope it) and omitted by the browser caller (RLS already scopes to the
 * member's org). A soft-deleted asset or one without a display variant is
 * skipped rather than rendered as a hole.
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

  let query = supabase
    .from("album_items")
    .select("album_id, caption, created_at, display_until, assets(id, variants, width, height, deleted_at)")
    .in("album_id", albumIds)
    .order("position", { ascending: true });
  if (orgId) query = query.eq("org_id", orgId);

  const { data, error } = await query;
  if (error) return albums;

  for (const item of (data ?? []) as unknown as ItemRow[]) {
    const asset = item.assets;
    if (!asset || asset.deleted_at) continue;
    const variant = readAssetVariant(asset.variants, DISPLAY_VARIANT);
    if (!variant) continue;
    albums[item.album_id]?.push({
      assetId: asset.id,
      src: mediaProxyPath({
        id: asset.id,
        variant: DISPLAY_VARIANT,
        content_hash: variant.contentHash,
        extension: variant.extension,
      }),
      width: asset.width,
      height: asset.height,
      caption: item.caption,
      addedAt: item.created_at,
      displayUntil: item.display_until,
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
