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
    .select("id, name, created_at, album_items(count)")
    .eq("org_id", org.orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Couldn't load albums: ${error.message}`);

  const albums = (data ?? []).map((album) => ({
    id: album.id,
    name: album.name,
    // Supabase returns the aggregate as a one-row array.
    count: Array.isArray(album.album_items) ? (album.album_items[0]?.count ?? 0) : 0,
  }));

  return <AlbumsView albums={albums} />;
}
