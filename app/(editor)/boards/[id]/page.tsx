import { notFound } from "next/navigation";
import { BoardDocError, parseBoardDoc } from "@/lib/board-doc";
import type { BoardZmanim } from "@/lib/board-zmanim";
import { screensShowingBoard } from "@/lib/board-screens";
import { hashBoardDoc } from "@/lib/bundle/hash";
import { requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { resolveChabadLocation } from "@/lib/zmanim/location";
import { isoDateInZone } from "@/lib/zmanim/resolve-zmanim";
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

  const zmanim = await resolveOrgZmanimPreview(supabase, orgLocation, board.id);

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
    timezone: string;
    postal_code: string | null;
    zmanim_location_id: string | null;
    zmanim_location_type: string | null;
    zmanim_location_name: string | null;
  } | null,
  boardId: string,
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

  /*
   * THE SHUL'S OWN DATE, not UTC — and this was a second, independent bug
   * in the same family as the missing rebuild invalidation.
   *
   * It used to be `new Date().toISOString().slice(0, 10)`, which is the UTC
   * calendar date. The widget asks the cache for `isoDateInZone(now,
   * timeZone)` (lib/zmanim/resolve-zmanim.ts) — the shul's date. West of
   * Greenwich those two disagree for the hours between local evening and
   * UTC midnight, so from about 8pm in New York this filter started at
   * TOMORROW and excluded the row the widget was about to ask for. The
   * editor showed "No zmanim for this date" every evening while the
   * display route, reading a bundle built with the same day's rows, was
   * fine.
   *
   * `lte` on the far end is harmless either way, but it is computed the
   * same way so the window is one consistent thing rather than two
   * conventions a day apart.
   */
  const timeZone = org?.timezone ?? "UTC";
  const today = isoDateInZone(new Date(), timeZone);
  const end = isoDateInZone(
    new Date(Date.now() + CHABAD_PREVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000),
    timeZone,
  );

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

  /*
   * THE RESOLVE-TIME LOG, and the reason it is worth a line in a page
   * component: a cache full of rows the widget cannot reach looks
   * identical to an empty cache now that there is no computed fallback
   * (plan.md §5c), and that ambiguity has now cost three debugging rounds
   * — the `item.Date` parse, the four missing candle-lighting parameters,
   * and a warm that queued no rebuild.
   *
   * It names the KEY and the WINDOW, which are the two things neither the
   * board nor the database can tell you on their own: the cache is keyed
   * `(provider, location_id, date)` and a mismatch in either the key or
   * the date convention reads as "no zmanim" with nothing else to see.
   * Logged whenever the read came back empty, since that is the only case
   * anybody needs it for.
   */
  const dates = Object.keys(chabadZmanim).sort();
  if (dates.length === 0) {
    console.warn(
      "[zmanim-resolve] " +
        JSON.stringify({
          where: "editor-preview",
          boardId,
          cacheKey: chabadLocation.cacheKey,
          timeZone,
          wanted: { from: today, to: end },
          found: 0,
        }),
    );
  }

  return { provider, hasChabadLocation: true, chabadZmanim };
}
