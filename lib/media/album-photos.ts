import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { mediaProxyPath, readAssetVariant } from "@/lib/bundle/media";

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

export type BoardPhoto = {
  assetId: string;
  src: string;
  width: number | null;
  height: number | null;
  caption: string | null;
};

/** Albums resolved to their ordered, ready photos, keyed by album id. */
export type BoardAlbums = Record<string, BoardPhoto[]>;

type ItemRow = {
  album_id: string;
  caption: string | null;
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
    .select("album_id, caption, assets(id, variants, width, height, deleted_at)")
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
    });
  }

  return albums;
}
