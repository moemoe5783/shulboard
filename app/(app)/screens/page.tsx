import Link from "next/link";
import { buttonClassName } from "@/components/Button";
import { requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/clock";
import { requestOrigin } from "@/lib/origin";
import { formatResolution, lastSeenLabel, screenStatus } from "@/lib/screens";
import { ScreensTable, type ScreenRow } from "./ScreensTable";

/*
 * The screens view — design.md §4, the one view the spec says to spend boldness
 * on. A live wall of what every screen in the building is showing right now.
 *
 * Everything is read with the anon key through RLS: the select policy on screens
 * is is_org_member(org_id), so the org filter below is belt to that braces
 * rather than the thing keeping shuls apart.
 */

export const dynamic = "force-dynamic";

export default async function ScreensPage() {
  const org = await requireActiveOrg();
  const supabase = await createClient();

  const { data: screens, error } = await supabase
    .from("screens")
    .select(
      "id, name, location_note, token, canvas_width, canvas_height, last_seen_at, playlist_id",
    )
    .eq("org_id", org.orgId)
    .order("name");

  if (error) {
    throw new Error(`Couldn't load the screens: ${error.message}`);
  }

  // The board each playlist is actually showing, in two plain queries rather
  // than an embed: the foreign key from screens to playlists is composite —
  // (playlist_id, org_id) — and asking PostgREST to resolve that relationship
  // is a bet on its inference. Not the playlist's own name: assignBoard names
  // an auto-created playlist after the screen's id (screens/actions.ts), and
  // nothing in the product shows that name anywhere else — showing it here
  // put a raw UUID in this column instead of the board a gabbai actually
  // asked for.
  const playlistIds = [...new Set((screens ?? []).map((s) => s.playlist_id).filter(Boolean))];
  const boardNameByPlaylist = new Map<string, string>();

  if (playlistIds.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from("playlist_items")
      .select("playlist_id, board_id")
      .in("playlist_id", playlistIds as string[])
      .order("position", { ascending: true });

    if (itemsError) {
      throw new Error(`Couldn't load what the screens are showing: ${itemsError.message}`);
    }

    // First item per playlist only — a playlist holds exactly one until
    // rotation exists (plan.md §1, §6), same assumption BoardPicker.tsx makes.
    const boardIdByPlaylist = new Map<string, string>();
    for (const item of items ?? []) {
      if (!boardIdByPlaylist.has(item.playlist_id)) {
        boardIdByPlaylist.set(item.playlist_id, item.board_id);
      }
    }

    const boardIds = [...new Set(boardIdByPlaylist.values())];
    if (boardIds.length > 0) {
      const { data: boards, error: boardsError } = await supabase
        .from("boards")
        .select("id, name")
        .in("id", boardIds);

      if (boardsError) {
        throw new Error(`Couldn't load what the screens are showing: ${boardsError.message}`);
      }
      const boardNames = new Map((boards ?? []).map((b) => [b.id, b.name]));
      for (const [playlistId, boardId] of boardIdByPlaylist) {
        const name = boardNames.get(boardId);
        if (name) boardNameByPlaylist.set(playlistId, name);
      }
    }
  }

  // Formatted here, on the server, against one clock. Doing it in the browser
  // would make the first paint disagree with the server's markup.
  const now = requestNow();
  const origin = await requestOrigin();
  const rows: ScreenRow[] = (screens ?? []).map((screen) => ({
    id: screen.id,
    name: screen.name,
    location: screen.location_note,
    showing: screen.playlist_id
      ? (boardNameByPlaylist.get(screen.playlist_id) ?? "Nothing scheduled")
      : "Nothing scheduled",
    status: screenStatus(screen.last_seen_at, now),
    lastSeen: lastSeenLabel(screen.last_seen_at, now),
    size: formatResolution(screen.canvas_width, screen.canvas_height),
    url: `${origin}/s/${screen.token}`,
  }));

  return (
    <>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-title">Screens</h1>
          {rows.length > 0 && (
            <p className="text-body text-ink-soft mt-1">
              What every screen in the building is showing right now.
            </p>
          )}
        </div>
        {/* When the list is empty the empty state carries the one primary, so
            this header action would be the second. One per view. */}
        {rows.length > 0 && (
          <Link href="/screens/new" className={buttonClassName("primary")}>
            Add screen
          </Link>
        )}
      </div>

      <div className="rounded-panel border-rule bg-surface mt-6 border">
        <ScreensTable rows={rows} />
      </div>
    </>
  );
}
