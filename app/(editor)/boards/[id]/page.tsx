import { notFound } from "next/navigation";
import { BoardDocError, parseBoardDoc } from "@/lib/board-doc";
import { screensShowingBoard } from "@/lib/board-screens";
import { hashBoardDoc } from "@/lib/bundle/hash";
import { requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { BoardEditor } from "./BoardEditor";

/*
 * The real editor — plan.md §4, at /boards/[id] rather than /editor-lab.
 *
 * A SEPARATE ROUTE GROUP, deliberately. This page shares no layout with
 * app/(app) — no nav rail, no padded content pane — because design.md §4's
 * editor is its own full-screen dark chrome, and the two route groups is how
 * Next.js lets one segment opt out of a layout its sibling still uses. See
 * app/(app)/boards/page.tsx for the list this is reached from.
 */

export const dynamic = "force-dynamic";

// A Server Action's timeout is set at the page that renders it, not in the
// action's own file (Next's own docs on maxDuration) — this is what gives
// publishBoard's after() background builds (actions.ts) room to actually
// finish for a screen count bigger than one or two, rather than being cut off
// mid-build by a short default. Same ceiling the cron worker gives itself for
// the identical work (app/api/cron/build-bundles/route.ts).
export const maxDuration = 60;

export default async function BoardEditorPage({ params }: PageProps<"/boards/[id]">) {
  const { id } = await params;
  const org = await requireActiveOrg();
  const supabase = await createClient();

  const { data: board, error } = await supabase
    .from("boards")
    .select("id, org_id, name, canvas_width, canvas_height, doc, published_at, published_hash")
    .eq("id", id)
    .eq("org_id", org.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Couldn't load the board: ${error.message}`);
  }
  if (!board) {
    notFound();
  }

  // Never-published and published-with-changes are both "the draft and what's
  // live disagree" for this comparison; PublishControls.tsx says them
  // differently by also checking publishedAt. A doc that fails to parse is
  // treated the same as a mismatch — flag it rather than claim it's clean.
  let pendingChanges = true;
  try {
    pendingChanges = hashBoardDoc(parseBoardDoc(board.doc)) !== board.published_hash;
  } catch (cause) {
    if (!(cause instanceof BoardDocError)) throw cause;
  }

  const screenIds = await screensShowingBoard(supabase, board.org_id, board.id);

  // A board isn't tied to one screen — it can sit on several playlists across
  // several screens, each with its own coordinates (screens.sql) — so there is
  // no single "right" screen to preview candle lighting or a sunset-rollover
  // Hebrew date against here. The org's own location is the
  // best available stand-in, same tier the bundle build falls back to
  // (lib/bundle/build.ts) when a screen hasn't set its own.
  const { data: orgLocation } = await supabase
    .from("orgs")
    .select("latitude, longitude, timezone")
    .eq("id", board.org_id)
    .maybeSingle();

  const location =
    typeof orgLocation?.latitude === "number" && typeof orgLocation.longitude === "number"
      ? { latitude: orgLocation.latitude, longitude: orgLocation.longitude, timeZone: orgLocation.timezone }
      : null;

  return (
    <BoardEditor
      boardId={board.id}
      name={board.name}
      canvas={{ width: board.canvas_width, height: board.canvas_height }}
      doc={board.doc}
      location={location}
      publishState={{
        publishedAt: board.published_at,
        screenCount: screenIds.length,
        pendingChanges,
      }}
    />
  );
}
