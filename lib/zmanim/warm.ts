import "server-only";
import { fetchChabadZmanim } from "./chabad-adapter.ts";
import { resolveChabadLocation, type ChabadLocation } from "./location";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * Warming one (chabad, location) pair into `zmanim_cache` — plan.md §5c's
 * "bundle reads from cache only, never calls a provider inline."
 *
 * NINETY-TWO DAYS, WHICH IS WHAT §5c ALWAYS ASKED FOR. "Warm 90 days
 * ahead" is achievable after all: Chabad's Get_Zmanim endpoint
 * (chabad-adapter.ts) returns the whole span in ONE request, carrying all
 * thirteen daily zmanim and candle lighting together. The four-week
 * ceiling that used to be documented here belonged to the published
 * candle-lighting embed, which was briefly the reader; it is no longer
 * the source and its cap no longer describes anything. chabad-embed.ts is
 * kept unwired as a fallback.
 *
 * EXTRACTED SO THERE IS ONE COPY. Two things warm this cache: the daily
 * cron (app/api/cron/warm-zmanim/route.ts) and the "Fetch now" button in
 * org settings. They differ entirely in what they warm and who may ask —
 * the cron sweeps every location any org or screen references, the button
 * does one org's own and is admin-gated and rate-limited — but the warming
 * itself is identical, and a second copy of it is how the two would drift
 * into caching different shapes.
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

/**
 * 92 days, inclusive of today — so `enddate` is today + 91.
 *
 * VERIFIED, NOT MEASURED AS A CAP. A hand-made request for Sep 10 through
 * Dec 10 2026 returned all 92 days with no coercion, and the response
 * echoed that same `EndDate` back. What happens at 120 or 365 days is
 * unknown: nobody has asked for more, so this is the largest span with
 * evidence behind it rather than a ceiling anyone has hit. That is the
 * opposite of the embed's four weeks, which WAS a measured cap (13 and 52
 * both came back byte-identical to 4, silently coerced).
 *
 * Because it is an unverified-above rather than a known limit, the
 * response's own `EndDate` is reported rather than assumed: `echoedEndDate`
 * and `requestedEndDate` both come back in the outcome, so a future
 * silent coercion shows up as two numbers that disagree instead of as a
 * cache that is quietly short. §5c's 90-day figure is the bundle's own
 * zmanim window; 92 covers it with two days to spare, which is what keeps
 * a daily cron from ever leaving a same-day gap.
 */
const WARM_DAYS = 92;

export type WarmOutcome =
  | {
      /**
       * Distinguished, not collapsed into one "it worked".
       *
       * A successful fetch that produced no `candle_lighting` on any day
       * is NOT a failure at the grain of a single day — plenty of days
       * legitimately have none: every ordinary weekday, and the second
       * night of a two-day Yom Tov, which Chabad files as a
       * `ShabbatEndTime` carrying a `LightCandlesAfter` footnote rather
       * than as a `CandleLighting`.
       *
       * Across 92 days it is a different claim entirely, and a stronger
       * alarm than it was at four weeks: 92 days contain thirteen
       * Fridays, so zero candle lightings anywhere in the response is the
       * signature of a silent shape change. That is not hypothetical —
       * it is exactly what a 91-day call returned before the request's
       * four missing trailing parameters were found, with the day count
       * looking perfectly healthy the whole time.
       *
       * The test is `> 0`, not a count tuned to any particular span.
       */
      status: "warmed" | "warmed-no-candle-lighting";
      /** Days the response carried zmanim for. Unlike the embed, this
       *  endpoint returns EVERY day in the range, so this is the window
       *  length and comparing it to 92 is meaningful. */
      dates: number;
      datesWithCandleLighting: number;
      /** The last date actually parsed out of `Days[]`, `YYYY-MM-DD`.
       *  This is the number that answers "how far ahead am I covered",
       *  which is the only thing a gabbai wants from a fetch. */
      lastDate: string | null;
      /** What was asked for, and what chabad.org said it gave — see
       *  WARM_DAYS on why both are reported rather than one assumed. */
      requestedEndDate: string;
      echoedEndDate: string | null;
      /** Distinct zman ids written across the window, so a mapping
       *  regression is visible in the cron's own JSON rather than only
       *  in a log line. */
      zmanIds: string[];
      /**
       * Screens queued for a bundle rebuild because this warm changed what
       * they would serve — see `queueRebuildsForCacheKey`.
       *
       * REPORTED RATHER THAN SILENT, because its being silent is what cost
       * a debugging round: a warm that writes 93 perfectly good rows and
       * queues nothing leaves every board saying "No zmanim for this date"
       * while every message about the warm says it worked. Zero here on a
       * location a shul really uses is the signature of that, visible in
       * the cron's own JSON and in the settings button's own sentence.
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

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
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

/**
 * Fetches and upserts one location's 92-day window. Never throws: every
 * caller reports an outcome rather than a stack trace — the cron into its
 * JSON response, the settings button into a line a gabbai reads.
 *
 * Rate limiting is deliberately NOT here. The cron runs once a day and
 * must never be refused because someone pressed a button thirty seconds
 * earlier; the button's own limit lives with the button.
 *
 * `now` is injectable only so a test can pin the window. Production
 * always passes nothing.
 */
export async function warmChabadLocation(
  target: ChabadLocation & { timezone: string },
  now: Date = new Date(),
): Promise<WarmOutcome> {
  const db = serviceClientOrNull();
  if (!db) return { status: "failed", error: "Supabase isn't configured on this deployment." };

  // Anchored on today IN THE TARGET'S OWN ZONE, not on UTC. A warm
  // running at 02:00 UTC would otherwise ask for tomorrow's window in
  // New York and leave today uncovered — the one date every widget on
  // every board is reading right now.
  const startDate = todayInZone(target.timezone, now);
  const endDate = addDays(startDate, WARM_DAYS - 1);

  try {
    const result = await fetchChabadZmanim({
      locationId: target.locationId,
      locationType: target.locationType,
      // What the response's own LocationName is checked against for a city
      // id — the whole reason a searched location stores its Title. A
      // mismatch throws, lands in the catch below, and this location is
      // reported failed rather than cached (chabad-adapter.ts's
      // verifyLocationName).
      expectedName: target.expectedName,
      startDate,
      endDate,
      timeZone: target.timezone,
    });

    const { times, rawResponseByDate } = result;

    // One row per date the response carried. `raw_response` gets that
    // date's own slice plus the response-level metadata a day cannot be
    // interpreted without — see the adapter's `rawResponseByDate`, which
    // is why this is not the whole ~105KB body written 92 times.
    const rows = Object.keys(times).map((date) => ({
      provider: "chabad" as const,
      location_id: target.cacheKey,
      date,
      timezone: target.timezone,
      times: times[date],
      raw_response: (rawResponseByDate[date] ?? null) as never,
      fetched_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await db
        .from("zmanim_cache")
        .upsert(rows, { onConflict: "provider,location_id,date" });
      if (error) throw new Error(error.message);
    }

    const zmanIds = [...new Set(Object.values(times).flatMap((day) => Object.keys(day)))].sort();

    // Only when rows were actually written. A response that parsed to
    // nothing changes no screen's answer, so queueing a rebuild for it
    // would be work for nothing.
    const screensQueued = rows.length > 0 ? await queueRebuildsForCacheKey(db, target.cacheKey) : 0;

    console.info(
      "[chabad-zmanim-warm] " +
        JSON.stringify({
          cacheKey: target.cacheKey,
          requested: { startDate, endDate, days: WARM_DAYS },
          echoedEndDate: result.echoedEndDate,
          location: result.location,
          firstDate: result.firstDate,
          lastDate: result.lastDate,
          rows: rows.length,
          zmanIds,
          candleLightingDates: result.candleLightingDates.length,
          bytes: result.bytes,
          screensQueued,
        }),
    );

    const datesWithCandleLighting = result.candleLightingDates.length;
    return {
      status: datesWithCandleLighting > 0 ? "warmed" : "warmed-no-candle-lighting",
      dates: rows.length,
      datesWithCandleLighting,
      lastDate: result.lastDate,
      requestedEndDate: endDate,
      echoedEndDate: result.echoedEndDate,
      zmanIds,
      screensQueued,
    };
  } catch (cause) {
    return { status: "failed", error: cause instanceof Error ? cause.message : String(cause) };
  }
}
