import "server-only";
import { fetchChabadRssZmanim } from "./chabad-rss.ts";
import { fetchChabadEmbed } from "./chabad-embed.ts";
import { resolveChabadLocation, type ChabadLocation } from "./location";
import { serviceClientOrNull } from "@/lib/supabase/service";
import type { ChabadZman } from "./zman.ts";

/*
 * Warming one (chabad, location) pair into `zmanim_cache` — plan.md §5c's
 * "bundle reads from cache only, never calls a provider inline."
 *
 * TWO SOURCES, ONE CACHE:
 *
 *  - The daily zmanim table comes from the published RSS feed
 *    (lib/zmanim/chabad-rss.ts), which returns TODAY only, no date range —
 *    so the full luach (all thirteen zmanim) is cached for today alone. A
 *    screen offline for more than a day shows the zmanim widget's unavailable
 *    state for the new date until it reconnects and the next daily warm
 *    rebuilds its bundle.
 *  - Candle lighting and Shabbos-end times come from the published embed
 *    (lib/zmanim/chabad-embed.ts), which returns FOUR WEEKS. So the
 *    candle-lighting widget's "upcoming" view keeps working days ahead, where
 *    the RSS feed alone would only carry the current erev-Shabbos date.
 *
 * Both are merged into `zmanim_cache.times` per date. The 92-day Get_Zmanim
 * reader (chabad-adapter.ts) is kept unwired for the day one request has to
 * carry the whole span again. The daily cron
 * (app/api/cron/warm-zmanim/route.ts) is what keeps today's date always
 * present and slides the four-week candle-lighting window forward.
 *
 * EXTRACTED SO THERE IS ONE COPY. Two things warm this cache: the daily
 * cron and the settings page's "Use this address" action. They differ
 * entirely in what they warm and who may ask — the cron sweeps every
 * location any org or screen references, the settings action does one org's
 * own and is admin-gated — but the warming itself is identical, and a second
 * copy of it is how the two would drift into caching different shapes.
 *
 * THIS MODULE HOLDS THE SERVICE-ROLE KEY, and that is not incidental.
 * `zmanim_cache` has exactly one RLS policy — a SELECT for any signed-in
 * user — and deliberately no write policy at all
 * (supabase/migrations/20260904091100_zmanim_cache.sql): the table is
 * shared across every org, so a write policy for tenant admins would let
 * one shul's admin poison the rows twenty neighbouring shuls read. The
 * table is written only by code that bypasses RLS, which is why this is a
 * named exception in CLAUDE.md rather than something the settings action
 * does with its own client.
 */

export type WarmOutcome =
  | {
      status: "warmed";
      /** Total date rows written — today's from the RSS feed, plus the
       *  candle-lighting/Shabbos-end dates from the 4-week embed. */
      dates: number;
      /** The date the RSS feed warmed, `YYYY-MM-DD` — today for the ZIP. The
       *  daily zmanim table lives on this date. */
      date: string | null;
      /** Dates carrying a candle-lighting time across the merged cache (RSS +
       *  embed) — the number the candle-lighting widget can actually reach. */
      candleLightingDates: number;
      /** The furthest candle-lighting date written, `YYYY-MM-DD` — how far
       *  ahead candle lighting is covered. */
      lastCandleLighting: string | null;
      /**
       * The 4-week candle-lighting embed failed while the RSS leg succeeded.
       * Today's zmanim are cached; upcoming candle lighting is not, until the
       * next run. A degraded warm, not a failed one — the zmanim widget still
       * works, the candle-lighting widget is a week behind.
       */
      embedFailed: boolean;
      /** Distinct zman ids written, so a mapping regression is visible in
       *  the cron's own JSON rather than only in a log line. */
      zmanIds: string[];
      /**
       * Screens queued for a bundle rebuild because this warm changed what
       * they would serve — see `queueRebuildsForCacheKey`.
       *
       * REPORTED RATHER THAN SILENT: `zmanim_cache` is read at BUILD time
       * and frozen into each screen's bundle, so a warm that writes a good
       * row and queues nothing leaves every board saying "No zmanim for this
       * date" while every message about the warm says it worked. Zero here on
       * a location a shul really uses is the signature of that.
       */
      screensQueued: number;
    }
  | { status: "failed"; error: string };

/** Today's calendar date in `timeZone`, `YYYY-MM-DD`. Built from
 *  `formatToParts` rather than trusting `format()`'s output shape, the
 *  same way lib/hebrew/civil-day.ts and lib/zmanim/resolve.ts do it:
 *  en-CA happens to render ISO-ish today, but the part types are the
 *  contract and the joined string isn't. */
function todayInZone(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The screen columns a Chabad location resolves from, joined to their org's.
 *
 * MIRRORS THE WARMING CRON'S OWN SCREEN SWEEP field for field
 * (app/api/cron/warm-zmanim/route.ts), deliberately: the invalidation below
 * is only correct while it computes the same key for a screen that the
 * cron's target list did and the bundle builder will. `screens` carries a
 * `postal_code` and a `zmanim_location_id` of its own and no type or name
 * (20260904090500_screens.sql), so those two come from the org — which is
 * what `resolveChabadLocation` already expects.
 */
type ScreenLocationRow = {
  id: string;
  postal_code: string | null;
  zmanim_location_id: string | null;
  orgs: {
    postal_code: string | null;
    zmanim_location_id: string | null;
    zmanim_location_type: string | null;
    zmanim_location_name: string | null;
  } | null;
};

function screenCacheKey(screen: ScreenLocationRow): string | null {
  return (
    resolveChabadLocation({
      screenPostalCode: screen.postal_code,
      orgPostalCode: screen.orgs?.postal_code,
      screenZmanimLocationId: screen.zmanim_location_id,
      orgZmanimLocationId: screen.orgs?.zmanim_location_id,
      orgZmanimLocationType: screen.orgs?.zmanim_location_type,
      orgZmanimLocationName: screen.orgs?.zmanim_location_name,
    })?.cacheKey ?? null
  );
}

/**
 * Queues a bundle rebuild for every screen this warm changed the answer for.
 *
 * THIS IS THE LINK THAT WAS MISSING, and its absence is a bug worth
 * describing because nothing about it looked wrong from either end.
 * `zmanim_cache` is read at BUILD time and frozen into
 * `screen_bundles.bundle.content.zmanim` (lib/bundle/build.ts's
 * `resolveContent`) — plan.md §3a's whole design, and the reason a screen
 * can run for months offline. So writing the cache changes nothing a screen
 * serves until that screen's bundle is rebuilt.
 *
 * Every other content table gets that rebuild for free, from the
 * `request_org_rebuild()` triggers in
 * supabase/migrations/20260904091400_rebuild_invalidation.sql — twelve
 * tables, `orgs` and `screens` among them. `zmanim_cache` is not one of
 * them and CANNOT BE: that function keys on `org_id` and this table
 * deliberately has none, because it is shared across every org (CLAUDE.md).
 * A trigger of the same shape has nothing to key on.
 *
 * So the invalidation is done here in application code, where the key that
 * was just written is known and a cross-tenant sweep is already this
 * module's business. The failure it fixes: save a ZIP (which DOES queue a
 * rebuild, via the `orgs` trigger), let the cron rebuild the bundle against
 * an empty cache, then warm — and the board says "No zmanim for this date"
 * indefinitely while the cache holds 93 perfectly good rows and every
 * message about the warm says it succeeded.
 *
 * ALREADY-QUEUED SCREENS ARE LEFT ALONE (`is("rebuild_requested_at",
 * null)`), not re-stamped. `build-bundles` drains its queue oldest-first
 * (plan.md §3f), so overwriting a screen's existing timestamp would push
 * one that has been waiting to the back of the line for no gain — it is
 * going to be rebuilt anyway, and the rebuild reads the cache as it is
 * then.
 *
 * Never throws. A warm that wrote its rows and failed to queue is still a
 * warm that wrote its rows; the count comes back as zero and the log says
 * why, rather than the whole outcome turning into a failure.
 */
async function queueRebuildsForCacheKey(
  db: NonNullable<ReturnType<typeof serviceClientOrNull>>,
  cacheKey: string,
): Promise<number> {
  // Every screen, across every org — the same cross-tenant read the cron
  // needs and no RLS policy can express, which is why this module holds the
  // service-role key (CLAUDE.md).
  const { data: screens, error } = await db
    .from("screens")
    // One literal — see lib/bundle/build.ts's note on why a concatenated
    // select string loses Supabase's row-type inference.
    .select(
      "id, postal_code, zmanim_location_id, orgs(postal_code, zmanim_location_id, zmanim_location_type, zmanim_location_name)",
    );

  if (error) {
    console.warn(`[chabad-zmanim-warm] couldn't read screens to invalidate ${cacheKey}: ${error.message}`);
    return 0;
  }

  const ids = (screens ?? [])
    .filter((screen) => screenCacheKey(screen as ScreenLocationRow) === cacheKey)
    .map((screen) => screen.id);

  if (ids.length === 0) return 0;

  const { data: queued, error: updateError } = await db
    .from("screens")
    .update({ rebuild_requested_at: new Date().toISOString() })
    .in("id", ids)
    .is("rebuild_requested_at", null)
    .select("id");

  if (updateError) {
    console.warn(`[chabad-zmanim-warm] couldn't queue rebuilds for ${cacheKey}: ${updateError.message}`);
    return 0;
  }

  return queued?.length ?? 0;
}

/** The embed's own unit of coverage, capped at 4 by chabad.org — see
 *  chabad-embed.ts's header (13 and 52 both come back byte-identical to 4).
 *  Asking for 4 is asking for the most it will give. */
const EMBED_WEEKS = 4;

/**
 * Fetches and upserts one location's zmanim. Never throws: every caller
 * reports an outcome rather than a stack trace — the cron into its JSON
 * response, the settings action into a line a gabbai reads.
 *
 * TWO LEGS. The RSS feed is the daily table (today only) and is the primary
 * one: if it fails, the warm fails. The embed is the four-week candle-lighting
 * window and is best-effort: if it fails, today's zmanim are still cached and
 * the outcome carries `embedFailed` rather than throwing away the good leg.
 *
 * Rate limiting is deliberately NOT here. The cron runs once a day and must
 * never be refused because a settings save happened moments earlier; any
 * caller-side limit lives with the caller.
 *
 * `now` is accepted so a test can pin a clock; the RSS feed decides its own
 * date (today for the ZIP). `todayInZone` is logged alongside the feed's date
 * so a timezone or DST mismatch between the two is visible.
 */
export async function warmChabadLocation(
  target: ChabadLocation & { timezone: string },
  now: Date = new Date(),
): Promise<WarmOutcome> {
  const db = serviceClientOrNull();
  if (!db) return { status: "failed", error: "Supabase isn't configured on this deployment." };

  // US ZIP only — both sources are `locationtype=2` (chabad-rss.ts,
  // chabad-embed.ts). A non-US city id (`locationtype=1`) has no path here, so
  // it is reported rather than fetched against endpoints that would ignore it.
  if (target.locationType !== "2") {
    return {
      status: "failed",
      error: "The zmanim feed is US-only for now — this shul needs a US ZIP on file.",
    };
  }

  const requestedToday = todayInZone(target.timezone, now);

  try {
    // Primary: today's full luach.
    const rss = await fetchChabadRssZmanim({
      locationId: target.locationId,
      locationType: target.locationType,
      timeZone: target.timezone,
    });

    // Best-effort: four weeks of candle lighting / Shabbos ends. Its failure
    // must not lose the RSS leg — the zmanim widget still works without it,
    // the candle-lighting widget is just a week behind.
    let embed: Awaited<ReturnType<typeof fetchChabadEmbed>> | null = null;
    let embedFailed = false;
    try {
      embed = await fetchChabadEmbed({ locationId: target.locationId, weeks: EMBED_WEEKS, timeZone: target.timezone });
    } catch (cause) {
      embedFailed = true;
      console.warn(
        `[chabad-zmanim-warm] embed failed for ${target.cacheKey}, caching RSS only: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    // MERGE: the embed's candle-lighting/Shabbos-end dates first, then the RSS
    // day overlaid on top — so today keeps its full table and every other date
    // carries what the embed supplied. Per-id, the RSS wins on today (its
    // candle_lighting is from the same 18-min-before-sunset source anyway).
    const merged: Record<string, Record<string, ChabadZman>> = {};
    const rawByDate: Record<string, unknown> = {};
    if (embed) {
      for (const [date, ids] of Object.entries(embed.times)) {
        merged[date] = { ...ids };
        rawByDate[date] = { source: "embed", raw: embed.raw };
      }
    }
    for (const [date, ids] of Object.entries(rss.times)) {
      merged[date] = { ...(merged[date] ?? {}), ...ids };
      rawByDate[date] = { source: "rss", rss: rss.rawResponseByDate[date] ?? null, ...(embed?.times[date] ? { embed: embed.raw } : {}) };
    }

    const rows = Object.keys(merged).map((date) => ({
      provider: "chabad" as const,
      location_id: target.cacheKey,
      date,
      timezone: target.timezone,
      times: merged[date],
      raw_response: (rawByDate[date] ?? null) as never,
      fetched_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await db
        .from("zmanim_cache")
        .upsert(rows, { onConflict: "provider,location_id,date" });
      if (error) throw new Error(error.message);
    }

    // Only when rows were actually written. A response that parsed to nothing
    // changes no screen's answer, so queueing a rebuild would be work for
    // nothing.
    const screensQueued = rows.length > 0 ? await queueRebuildsForCacheKey(db, target.cacheKey) : 0;

    const candleLightingDatesList = Object.keys(merged)
      .filter((date) => merged[date].candle_lighting)
      .sort();
    const zmanIds = [...new Set(Object.values(merged).flatMap((ids) => Object.keys(ids)))].sort();

    console.info(
      "[chabad-zmanim-warm] " +
        JSON.stringify({
          cacheKey: target.cacheKey,
          requestedToday,
          feedDate: rss.date,
          location: rss.location,
          rows: rows.length,
          zmanIds,
          candleLightingDates: candleLightingDatesList.length,
          lastCandleLighting: candleLightingDatesList.at(-1) ?? null,
          embedFailed,
          embedEntries: embed?.entries ?? 0,
          screensQueued,
        }),
    );

    return {
      status: "warmed",
      dates: rows.length,
      date: rss.date,
      candleLightingDates: candleLightingDatesList.length,
      lastCandleLighting: candleLightingDatesList.at(-1) ?? null,
      embedFailed,
      zmanIds,
      screensQueued,
    };
  } catch (cause) {
    return { status: "failed", error: cause instanceof Error ? cause.message : String(cause) };
  }
}
