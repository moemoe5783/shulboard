import { notFound } from "next/navigation";
import { mediaProxyPath, readAssetVariant } from "@/lib/bundle/media";
import { requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { AlbumDetail, type AlbumPhoto } from "./AlbumDetail";

export const dynamic = "force-dynamic";

/** Build the proxy URL for one variant of an asset, or null if it isn't on
 *  file (unprocessed, or a shape this build doesn't recognise). */
function variantUrl(id: string, variants: unknown, name: string): string | null {
  const variant = readAssetVariant(variants, name);
  if (!variant) return null;
  return mediaProxyPath({ id, variant: name, content_hash: variant.contentHash, extension: variant.extension });
}

export default async function AlbumDetailPage({ params }: PageProps<"/media/[albumId]">) {
  const { albumId } = await params;
  const org = await requireActiveOrg();
  const supabase = await createClient();

  const { data: album } = await supabase
    .from("albums")
    .select("id, name")
    .eq("id", albumId)
    .eq("org_id", org.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!album) notFound();

  const { data: items, error } = await supabase
    .from("album_items")
    .select("asset_id, caption, position, display_until, assets(id, variants, width, height, deleted_at)")
    .eq("album_id", albumId)
    .eq("org_id", org.orgId)
    .order("position", { ascending: true });

  if (error) throw new Error(`Couldn't load the album: ${error.message}`);

  const photos: AlbumPhoto[] = [];
  let maxPosition = 0;
  for (const item of items ?? []) {
    const asset = item.assets as unknown as {
      id: string;
      variants: unknown;
      width: number | null;
      height: number | null;
      deleted_at: string | null;
    } | null;
    if (!asset || asset.deleted_at) continue;
    const thumb = variantUrl(asset.id, asset.variants, "thumb") ?? variantUrl(asset.id, asset.variants, "display");
    if (!thumb) continue;
    maxPosition = Math.max(maxPosition, item.position);
    photos.push({
      assetId: asset.id,
      caption: item.caption ?? "",
      thumbUrl: thumb,
      width: asset.width,
      height: asset.height,
      displayUntil: item.display_until ?? null,
    });
  }

  return (
    <AlbumDetail
      albumId={album.id}
      albumName={album.name}
      orgId={org.orgId}
      timeZone={org.timezone}
      photos={photos}
      nextPosition={maxPosition + 1}
    />
  );
}
