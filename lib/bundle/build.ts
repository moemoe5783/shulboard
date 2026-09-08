import "server-only";

import type { Database, Json } from "@/lib/database.types";
import { serviceClient } from "@/lib/supabase/service";
import { assembleBundle, assetIdsFor, type AssetRow } from "./assemble";
import { hashPayload, payloadBytes } from "./hash";
import { readAssetVariant } from "./media";
import type { BundleContent, BundlePayload } from "./types";

/** Exactly the columns buildScreenBundle's own select fetches — named so
 *  assemblePayloadFor's signature is checked against the real `screens`
 *  schema instead of the `Record<string, unknown>` this used to accept
 *  (which a `screen as never` cast then forced past the compiler entirely). */
type ScreenForBuild = Pick<
  Database["public"]["Tables"]["screens"]["Row"],
  | "id"
  | "org_id"
  | "name"
  | "canvas_width"
  | "canvas_height"
  | "orientation"
  | "timezone"
  | "latitude"
  | "longitude"
  | "hebrew_prefs"
  | "playlist_id"
  | "rebuild_requested_at"
>;

/** Which generated derivative a bundle embeds. dataNeeds carries only an
 *  `assetId` today, not a requested size (widgets/types.ts) — until a widget
 *  needs to ask for a specific one, "display" (1080px, plan.md §6: "screens
 *  fetch by slot size, not the original") is the one variant every board
 *  embeds. */
const BOARD_ASSET_VARIANT = "display";

/*
 * The build job — docs/plan.md §3a, docs/schema.md §9 and §10.
 *
 * A BACKGROUND JOB. The display route only ever reads `screen_bundles`; nothing
 * on the request path builds anything. That separation is what makes the next
 * property possible.
 *
 * A FAILED BUILD LEAVES THE PREVIOUS BUNDLE SERVING. The payload is constructed
 * in memory and hashed, and only then written. Any failure — a widget config
 * that will not parse, a missing playlist, an out-of-memory — throws before the
 * write, so the existing row is untouched and every screen polling it keeps
 * getting the last good bundle with its last good ETag. The display never sees a
 * partial bundle because a partial bundle is never written.
 *
 * VERSION BUMPS ONLY ON REAL CHANGE. §10 makes invalidation deliberately
 * over-eager — any content write flags every screen in the org — and this is why
 * that is cheap. A rebuild producing identical content updates `built_at` and
 * stops: `version` does not move, `payload` is not rewritten, no screen
 * refetches or cross-fades. The expensive thing was never the rebuild.
 */

/** How many days of each kind of content the bundle carries (§3a, §3b). */
const EVENT_LOOKAHEAD_DAYS = 30;
const ANNIVERSARY_LOOKAHEAD_DAYS = 60;
const ZMANIM_LOOKAHEAD_DAYS = 90;

export type BuildResult =
  | { status: "built"; screenId: string; version: number; contentHash: string; durationMs: number }
  | { status: "unchanged"; screenId: string; version: number; durationMs: number }
  | { status: "failed"; screenId: string; error: string };

const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Build one screen's bundle and write it if the content actually changed.
 *
 * Never throws for an ordinary failure — a build that cannot complete is a
 * result, not an exception, because the caller is a worker walking a queue and
 * one bad screen must not stop the other five in the shul.
 */
export async function buildScreenBundle(screenId: string): Promise<BuildResult> {
  const startedAt = Date.now();
  const db = serviceClient();

  try {
    const { data: screen, error: screenError } = await db
      .from("screens")
      .select(
        "id, org_id, name, canvas_width, canvas_height, orientation, timezone, latitude, longitude, hebrew_prefs, playlist_id, rebuild_requested_at",
      )
      .eq("id", screenId)
      .maybeSingle();

    if (screenError) throw new Error(`could not read the screen: ${screenError.message}`);
    if (!screen) return { status: "failed", screenId, error: "no such screen" };

    /*
     * THE RACE THAT MATTERS — §10.
     *
     * Captured here, at the START of the build, and compared before the flag is
     * cleared. If somebody edits content while this build is running, the flag
     * gets a newer timestamp, the comparison fails, the flag stays set and the
     * screen rebuilds again. Clearing it unconditionally would drop that edit
     * until the next unrelated change — a stale screen in a lobby with nothing
     * anywhere reporting an error, which is the exact failure the whole of §3
     * exists to prevent.
     */
    const requestedAt = screen.rebuild_requested_at as string | null;

    const payload = await assemblePayloadFor(db, screen);
    const contentHash = hashPayload(payload);
    const durationMs = Date.now() - startedAt;

    // Only version and content_hash. The stored payload is TOASTed and this
    // comparison never needs it.
    const { data: existing } = await db
      .from("screen_bundles")
      .select("version, content_hash")
      .eq("screen_id", screenId)
      .maybeSingle();

    if (existing && existing.content_hash === contentHash) {
      await db
        .from("screen_bundles")
        .update({ built_at: new Date().toISOString(), build_duration_ms: durationMs })
        .eq("screen_id", screenId);

      await clearRebuildFlag(db, screenId, requestedAt);
      return { status: "unchanged", screenId, version: existing.version, durationMs };
    }

    const version = (existing?.version ?? 0) + 1;

    const { error: writeError } = await db.from("screen_bundles").upsert(
      {
        screen_id: screenId,
        org_id: screen.org_id,
        version,
        content_hash: contentHash,
        // BundlePayload is JSON-safe by construction — canonicalJson
        // (lib/bundle/hash.ts) already assumes as much to hash it — but its
        // Record<string, unknown>/unknown[] fields can't be proven so
        // structurally against the generated `Json` type. This is the one
        // place that trust transfers into the column's declared shape.
        payload: payload as unknown as NonNullable<Json>,
        byte_size: payloadBytes(payload),
        built_at: new Date().toISOString(),
        build_duration_ms: durationMs,
      },
      { onConflict: "screen_id" },
    );

    if (writeError) throw new Error(`could not write the bundle: ${writeError.message}`);

    await clearRebuildFlag(db, screenId, requestedAt);
    await broadcastBundleChanged(db, screenId, version);
    return { status: "built", screenId, version, contentHash, durationMs };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);

    // The flag stays set, the attempt is counted, and the previous bundle keeps
    // serving throughout. The dashboard surfaces this; a screen never blanks.
    await db.rpc("record_bundle_build_failure", { p_screen_id: screenId, p_error: error });
    return { status: "failed", screenId, error };
  }
}

/**
 * Tell the screen's own Realtime channel its bundle changed — docs/plan.md
 * §3d, and the sender half of what lib/display/realtime.ts has been
 * listening for since that module was written: the authorization (the JWT
 * minting route, the RLS policy on realtime.messages) already existed with
 * nothing on this end ever publishing.
 *
 * ONLY CALLED AFTER A REAL VERSION BUMP, never after an "unchanged" rebuild —
 * schema.md §10 says so explicitly, and it's what keeps over-invalidation
 * cheap: an org-wide flag touches every screen, but only the ones whose
 * content actually changed get told to refetch right now.
 *
 * httpSend, not send()+subscribe(): this is a serverless build job with no
 * reason to hold a websocket open, and the Realtime REST broadcast endpoint
 * is exactly the "publish one message and go" primitive that needs. The
 * client here is the service-role client (serviceClient()), which is what
 * authorizes the send — supabase-js falls back to the client's own key as
 * its access token when there is no session, which is always true for this
 * client, and 20260908090000_realtime_channel_authorization.sql's own
 * comment says publishing bypassing RLS this way is the intended design, not
 * a workaround.
 *
 * NEVER ALLOWED TO FAIL THE BUILD. The bundle is already written and correct
 * at this point; a screen that misses this notice still gets the same
 * update within 60 seconds from its own unconditional poll
 * (lib/display/useDisplay.ts) — the exact belt-and-suspenders plan.md §3d
 * asks for, because a websocket that looks open and says nothing is the
 * real, silent TV failure mode.
 */
async function broadcastBundleChanged(
  db: ReturnType<typeof serviceClient>,
  screenId: string,
  version: number,
): Promise<void> {
  const channel = db.channel(`screen:${screenId}`, { config: { private: true } });
  try {
    await channel.httpSend("bundle_changed", { version });
  } catch {
    // Swallowed on purpose — see the comment above.
  } finally {
    await db.removeChannel(channel);
  }
}

/**
 * Clear the rebuild flag, but only if nobody has touched it since the build
 * began. See the note above — this conditional update is the whole mechanism.
 */
async function clearRebuildFlag(
  db: ReturnType<typeof serviceClient>,
  screenId: string,
  requestedAt: string | null,
) {
  const query = db
    .from("screens")
    .update({
      rebuild_requested_at: null,
      rebuild_attempts: 0,
      rebuild_last_error: null,
      rebuild_last_attempt_at: new Date().toISOString(),
    })
    .eq("id", screenId);

  // `is` for the null case: `eq` against null matches nothing in SQL, so a
  // screen flagged with a null timestamp would never have its flag cleared.
  const { error } = await (requestedAt === null
    ? query.is("rebuild_requested_at", null)
    : query.eq("rebuild_requested_at", requestedAt));

  if (error) throw new Error(`could not clear the rebuild flag: ${error.message}`);
}

async function assemblePayloadFor(
  db: ReturnType<typeof serviceClient>,
  screen: ScreenForBuild,
): Promise<BundlePayload> {
  const orgId = screen.org_id;
  const playlistId = screen.playlist_id;

  const [{ data: org }, playlist] = await Promise.all([
    db.from("orgs").select("theme, timezone, latitude, longitude").eq("id", orgId).maybeSingle(),
    playlistId
      ? db
          .from("playlists")
          .select("id, name, default_duration_seconds")
          .eq("id", playlistId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: rawItems } = playlistId
    ? await db
        .from("playlist_items")
        .select("board_id, position, duration_seconds")
        .eq("playlist_id", playlistId)
        .order("position")
    : { data: [] };

  // duration_seconds is nullable on the row — an item with no override runs
  // for the playlist's own default. Resolving that here, rather than letting
  // a null ride into the bundle as a board's rotation time, is exactly the
  // kind of mismatch a generated type catches and `any` could not: a null
  // duration reaching the display would either freeze on that board forever
  // or throw computing setTimeout(null * 1000).
  const defaultDuration = playlist?.data?.default_duration_seconds ?? 30;
  const items = (rawItems ?? []).map((item) => ({
    ...item,
    duration_seconds: item.duration_seconds ?? defaultDuration,
  }));

  const boardIds = [...new Set(items.map((item) => item.board_id).filter(Boolean))];

  // published_doc, never doc — the draft never reaches a screen. A board that
  // has never been published has a null published_doc and is excluded here,
  // so it contributes nothing to this bundle: DisplayBoard.tsx already
  // handles a playlist item with no matching board entry by showing its
  // "no board yet" state, which is exactly right for "not published yet"
  // too.
  const { data: rawBoards } = boardIds.length
    ? await db
        .from("boards")
        .select("id, name, published_doc")
        .in("id", boardIds)
        .not("published_doc", "is", null)
    : { data: [] };

  const boards = (rawBoards ?? []).map((board) => ({
    id: board.id,
    name: board.name,
    doc: board.published_doc,
  }));

  // Two passes over the boards: the first only to learn which assets are
  // referenced, so exactly those rows are fetched rather than every asset the
  // org owns. A shul with two thousand kiddush photographs and one on the board
  // should transfer one row.
  const referenced = new Set<string>();
  for (const board of boards) {
    try {
      const { parseBoardDoc } = await import("@/lib/board-doc");
      for (const id of assetIdsFor(parseBoardDoc(board.doc).widgets)) referenced.add(id);
    } catch {
      // A board that will not parse fails the whole build below, when it is
      // parsed for real. This pass just skips it.
    }
  }

  const assets = new Map<string, AssetRow>();
  if (referenced.size > 0) {
    // Soft-deleted assets never enter the bundle (schema.md §6) — the widget
    // that referenced one falls back to resolveWidgetAssets leaving it alone,
    // which is its own empty state, not a build failure over one deleted photo.
    const { data: rows } = await db
      .from("assets")
      .select("id, variants")
      .in("id", [...referenced])
      .is("deleted_at", null);

    for (const row of rows ?? []) {
      const variant = readAssetVariant(row.variants, BOARD_ASSET_VARIANT);
      // Not processed yet, or generated in a shape this build doesn't
      // recognise. Either way the widget shows its own empty state.
      if (!variant) continue;
      assets.set(row.id, {
        id: row.id,
        variant: BOARD_ASSET_VARIANT,
        content_hash: variant.contentHash,
        extension: variant.extension,
        content_type: variant.contentType,
        bytes: variant.bytes,
      });
    }
  }

  const content = await resolveContent(db, orgId);

  // Screen overrides org, same tier order the schema comments on both tables
  // describe (screens.sql, orgs.sql) and the same pattern §5c already
  // establishes for the zmanim provider — a screen only carries these columns
  // at all for the shul with two buildings on two different blocks; every
  // other screen leaves them null and inherits the org's.
  const timezone = screen.timezone ?? org?.timezone ?? null;
  const latitude = screen.latitude ?? org?.latitude ?? null;
  const longitude = screen.longitude ?? org?.longitude ?? null;

  return assembleBundle({
    screen: {
      id: screen.id,
      name: screen.name,
      canvas_width: screen.canvas_width,
      canvas_height: screen.canvas_height,
      orientation: screen.orientation,
      timezone,
      latitude,
      longitude,
      // The CHECK constraint on this column (jsonb_typeof(hebrew_prefs) =
      // 'object') guarantees the object shape AssembleInput expects; the
      // generated type only knows it as jsonb in general, which is where
      // this one cast earns its keep.
      hebrew_prefs: screen.hebrew_prefs as Record<string, unknown>,
    },
    theme: (org?.theme as Record<string, unknown>) ?? {},
    playlist: playlist?.data ? { id: playlist.data.id, name: playlist.data.name } : null,
    playlistItems: items,
    boards,
    content,
    assets,
  });
}

/**
 * The human-entered content, with the lookahead §3b specifies.
 *
 * Only these can go stale offline — everything else the display computes for
 * itself — and the 30-to-60 day windows mean even they keep rotating for weeks
 * on a screen that never reconnects.
 */
async function resolveContent(
  db: ReturnType<typeof serviceClient>,
  orgId: string,
): Promise<BundleContent> {
  const [announcements, schedules, people, events, zmanim] = await Promise.all([
    db
      .from("announcements")
      .select("*")
      .eq("org_id", orgId)
      .order("position", { ascending: true }),
    db.from("schedules").select("*").eq("org_id", orgId).order("position", { ascending: true }),
    db.from("people").select("*").eq("org_id", orgId),
    db
      .from("calendar_events")
      .select("*")
      .eq("org_id", orgId)
      .lte("starts_at", isoDaysFromNow(EVENT_LOOKAHEAD_DAYS))
      .order("starts_at", { ascending: true }),
    db
      .from("zmanim_cache")
      .select("*")
      .lte("date", isoDaysFromNow(ZMANIM_LOOKAHEAD_DAYS))
      .gte("date", isoDaysFromNow(-1)),
  ]);

  const byDate: Record<string, unknown> = {};
  for (const row of zmanim.data ?? []) byDate[String((row as { date: string }).date)] = row;

  return {
    announcements: announcements.data ?? [],
    schedules: schedules.data ?? [],
    // The anniversary window is applied when the widget renders, from Hebrew
    // dates the display computes itself — the bundle carries the people.
    people: people.data ?? [],
    events: events.data ?? [],
    zmanim: byDate,
  };
}

export const LOOKAHEAD = {
  events: EVENT_LOOKAHEAD_DAYS,
  anniversaries: ANNIVERSARY_LOOKAHEAD_DAYS,
  zmanim: ZMANIM_LOOKAHEAD_DAYS,
};
