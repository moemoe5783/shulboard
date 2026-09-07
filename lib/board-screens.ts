import type { Database } from "@/lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Which screens show a given board, right now.
 *
 * Two plain queries rather than an embed, the same reasoning as
 * app/(app)/screens/page.tsx: the foreign key from screens to playlists is
 * composite — (playlist_id, org_id) — and asking PostgREST to resolve that
 * relationship through playlist_items is a bet on its inference.
 *
 * Takes the caller's own Supabase client (anon key, RLS applied) rather than
 * opening one — this runs under the acting user's session in both places it's
 * called from (the board editor page's initial load, and the publish action),
 * and needs no more access than an org member already has to playlist_items
 * and screens.
 */
export async function screensShowingBoard(
  supabase: SupabaseClient<Database>,
  orgId: string,
  boardId: string,
): Promise<string[]> {
  const { data: items, error: itemsError } = await supabase
    .from("playlist_items")
    .select("playlist_id")
    .eq("org_id", orgId)
    .eq("board_id", boardId);

  if (itemsError) {
    throw new Error(`Couldn't find which screens show this board: ${itemsError.message}`);
  }

  const playlistIds = [...new Set((items ?? []).map((item) => item.playlist_id))];
  if (playlistIds.length === 0) return [];

  const { data: screens, error: screensError } = await supabase
    .from("screens")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .in("playlist_id", playlistIds);

  if (screensError) {
    throw new Error(`Couldn't find which screens show this board: ${screensError.message}`);
  }

  return (screens ?? []).map((screen) => screen.id);
}
