import { requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { AlbumsView } from "./AlbumsView";

/*
 * The Media section — plan.md §6: albums with manual upload, the universal
 * primitive the Gallery, Collage and Image widgets bind to.
 *
 * Read through RLS with the org's own client, like every other dashboard list.
 */

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const org = await requireActiveOrg();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("albums")
    .select("id, name, created_at")
    .eq("org_id", org.orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Couldn't load albums: ${error.message}`);

  // Photo counts from the items themselves, NOT an embedded `album_items(count)`:
  // that is a PostgREST aggregate, which Supabase projects have switched off
  // by default, and asking for it failed this whole page. Counting here also
  // leaves out photos that were deleted (a soft-deleted asset stays linked).
  const { data: items } = await supabase
    .from("album_items")
    .select("album_id, assets(deleted_at)")
    .eq("org_id", org.orgId);
  const counts = new Map<string, number>();
  for (const item of items ?? []) {
    const asset = item.assets as unknown as { deleted_at: string | null } | null;
    if (!asset || asset.deleted_at) continue;
    counts.set(item.album_id, (counts.get(item.album_id) ?? 0) + 1);
  }

  const albums = (data ?? []).map((album) => ({ id: album.id, name: album.name, count: counts.get(album.id) ?? 0 }));

  return <AlbumsView albums={albums} />;
}
