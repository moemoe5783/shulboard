import { notFound } from "next/navigation";
import { BoardDocError, parseBoardDoc } from "@/lib/board-doc";
import type { BoardZmanim } from "@/lib/board-zmanim";
import { screensShowingBoard } from "@/lib/board-screens";
import { hashBoardDoc } from "@/lib/bundle/hash";
import { requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { resolveChabadLocation } from "@/lib/zmanim/location";
import { effectiveZmanimProvider } from "@/lib/zmanim/provider";
import { BoardEditor } from "./BoardEditor";

/** How many days ahead the editor's own live Chabad preview reads —
 *  matching lib/hebrew/candle-times.ts's own SEARCH_WINDOW_DAYS, since both
 *  are answering the identical question ("the next candle lighting from
 *  today") just against two different sources. */
const CHABAD_PREVIEW_WINDOW_DAYS = 9;

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
    // One literal — see lib/bundle/build.ts's note: a concatenated select
    // string loses Supabase's row-type inference.
    .select("latitude, longitude, timezone, zmanim_provider, postal_code, zmanim_location_id, zmanim_location_type, zmanim_location_name")
    .eq("id", board.org_id)
    .maybeSingle();

  const location =
    typeof orgLocation?.latitude === "number" && typeof orgLocation.longitude === "number"
      ? { latitude: orgLocation.latitude, longitude: orgLocation.longitude, timeZone: orgLocation.timezone }
      : null;

  const zmanim = await resolveOrgZmanimPreview(supabase, orgLocation);

  return (
    <BoardEditor
      boardId={board.id}
      name={board.name}
      canvas={{ width: board.canvas_width, height: board.canvas_height }}
      doc={board.doc}
      location={location}
      zmanim={zmanim}
      publishState={{
        publishedAt: board.published_at,
        screenCount: screenIds.length,
        pendingChanges,
      }}
    />
  );
}

/**
 * The org's zmanim config, live — for the editor preview only. The display
 * route never does this: it reads `bundle.content.zmanim`, already resolved
 * at build time (lib/bundle/build.ts). The editor has no bundle, only a
 * database connection under RLS, so it reads `zmanim_cache` directly —
 * permitted by that table's own select policy ("cached zmanim are readable
 * by any signed-in user", schema.md §8), which exists for exactly this.
 *
 * Same tier order as `location` above: org only, since a board isn't tied
 * to one screen (see this file's own comment on that).
 */
async function resolveOrgZmanimPreview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  org: {
    zmanim_provider: string;
    postal_code: string | null;
    zmanim_location_id: string | null;
    zmanim_location_type: string | null;
    zmanim_location_name: string | null;
  } | null,
): Promise<BoardZmanim | null> {
  // Always Chabad — lib/zmanim/provider.ts. The stored value is passed in
  // so the day the choice comes back this line is already right.
  const provider = effectiveZmanimProvider(org?.zmanim_provider);

  const chabadLocation = resolveChabadLocation({
    orgPostalCode: org?.postal_code,
    orgZmanimLocationId: org?.zmanim_location_id,
    orgZmanimLocationType: org?.zmanim_location_type,
    orgZmanimLocationName: org?.zmanim_location_name,
  });
  if (!chabadLocation) return { provider, hasChabadLocation: false, chabadZmanim: null };

  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + CHABAD_PREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: rows } = await supabase
    .from("zmanim_cache")
    .select("date, times")
    .eq("provider", "chabad")
    .eq("location_id", chabadLocation.cacheKey)
    .gte("date", today)
    .lte("date", end);

  const chabadZmanim: NonNullable<BoardZmanim["chabadZmanim"]> = {};
  for (const row of rows ?? []) {
    chabadZmanim[row.date] = (row.times as NonNullable<BoardZmanim["chabadZmanim"]>[string]) ?? {};
  }

  return { provider, hasChabadLocation: true, chabadZmanim };
}
