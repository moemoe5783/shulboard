import "server-only";
import { fetchChabadEmbed } from "./chabad-embed.ts";
import type { ChabadLocation } from "./location";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * Warming one (chabad, location) pair into `zmanim_cache` — plan.md §5c's
 * "bundle reads from cache only, never calls a provider inline."
 *
 * §5c also says "warm 90 days ahead", and for Chabad that is not
 * achievable: the embed caps at four weeks (see WARM_WEEKS). The 90-day
 * figure still describes the bundle's own zmanim window, which Hebcal
 * fills by computing client-side.
 *
 * Reads Chabad.org's PUBLISHED candle-lighting embed (chabad-embed.ts),
 * which is what Chabad.org pointed at when asked. The old Get_Zmanim JSON
 * reader is kept but no longer called from here — see chabad-adapter.ts.
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
 * FOUR IS THE CAP, MEASURED — not a preference and not derived from
 * anything.
 *
 * `weeks=13` and `weeks=52` both come back byte-identical to `weeks=4`,
 * with the response's own final URL rewritten to `weeks=4`: 13 entries
 * spanning Fri Sep 11 to Sun Oct 4. Two values tested, both silently
 * coerced. The endpoint never rejects a larger number and never warns,
 * so asking for more is not a harmless over-request — it is a number that
 * reads like a 90-day window in the code while the cache only ever holds
 * about 24 days.
 *
 * There is deliberately no `ceil(90 / 7)` here any more. That arithmetic
 * looked like it set the window and never did: the plan's 90-day figure
 * (§5c, §3b) is the BUNDLE's zmanim window, which Hebcal fills by
 * computing client-side. Chabad's embed simply does not offer 90 days,
 * and pretending otherwise in a constant is how the discrepancy stayed
 * invisible.
 *
 * REAL COVERAGE: about 24 days, and only Fridays, Shabbos and Yom Tov
 * days within them — never ordinary weekdays, which the embed does not
 * return at all. Every date past that falls through to §5c's Hebcal path
 * with the "showing calculated times" indicator. That is the designed
 * behaviour of the fallback chain, not a gap: nothing here treats a
 * short window as a warming failure, and nothing compares what came back
 * against 90 days.
 */
const WARM_WEEKS = 4;

export type WarmOutcome =
  | {
      /**
       * Distinguished, not collapsed into one "it worked".
       *
       * A successful fetch that produced no `candle_lighting` on any day is
       * NOT a failure. Plenty of individual days legitimately have none —
       * an ordinary Thursday, or the second night of a two-day Yom Tov,
       * which chabad.org reports as `ShabbatEndTime` and the adapter
       * deliberately excludes (test/fixtures/chabad-zmanim-33710-sep2026
       * .json's 9/12 entry).
       *
       * Across the window, though, zero is a different claim, and it
       * still holds at four weeks: four weeks contain four Fridays, so
       * zero candle lightings anywhere in the response is the signature of
       * a silent shape change — which is exactly what bit the previous
       * reader, when a parsing bug skipped every day and nothing anywhere
       * said so.
       *
       * The test is `> 0`, not a count tuned to any particular span, so
       * shortening the window from a notional thirteen weeks to the real
       * four did not weaken it. Telling the two apart is the point, for
       * the cron's JSON and for the gabbai reading the settings page's own
       * "Fetch now" line alike.
       */
      status: "warmed" | "warmed-no-candle-lighting";
      /** Dates the response carried a value for — candle lighting or a
       *  Shabbos/Yom Tov end time. NOT a day count of the window: the
       *  embed returns only those days, never ordinary weekdays. */
      dates: number;
      datesWithCandleLighting: number;
      /** The last date covered, `YYYY-MM-DD`, or null if nothing came
       *  back. This is the number that answers "how far ahead am I
       *  covered", which is the only thing a gabbai wants from a fetch. */
      lastDate: string | null;
    }
  | { status: "failed"; error: string };

/**
 * Fetches and upserts one location's coverage window — about four weeks. Never throws: every caller
 * reports an outcome rather than a stack trace — the cron into its JSON
 * response, the settings button into a line a gabbai reads.
 *
 * Rate limiting is deliberately NOT here. The cron runs once a day and must
 * never be refused because someone pressed a button thirty seconds earlier;
 * the button's own limit lives with the button.
 */
export async function warmChabadLocation(
  target: ChabadLocation & { timezone: string },
): Promise<WarmOutcome> {
  const db = serviceClientOrNull();
  if (!db) return { status: "failed", error: "Supabase isn't configured on this deployment." };

  // No explicit date range: the embed takes `weeks` and decides its own
  // window from today.
  try {
    const { times, raw, location, entries, firstDate, lastDate } = await fetchChabadEmbed({
      locationId: target.locationId,
      weeks: WARM_WEEKS,
      timeZone: target.timezone,
    });

    // One row per date the response actually carried a value for. Unlike
    // the JSON endpoint, the embed only returns candle-lighting and
    // Shabbos-end days at all — there are no ordinary weekdays in it to
    // write empty rows for, so the row count IS the useful-day count.
    //
    // `raw_response` gets the whole untouched body on every row rather
    // than a per-date slice: the embed is one document covering the range,
    // it does not decompose into per-day payloads, and at ~6KB for four
    // weeks the duplication is cheaper than losing the ability to see what
    // was served.
    const rows = Object.keys(times).map((date) => ({
      provider: "chabad" as const,
      location_id: target.cacheKey,
      date,
      timezone: target.timezone,
      times: times[date],
      raw_response: raw as never,
      fetched_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await db
        .from("zmanim_cache")
        .upsert(rows, { onConflict: "provider,location_id,date" });
      if (error) throw new Error(error.message);
    }

    console.info(
      "[chabad-embed] " +
        JSON.stringify({
          cacheKey: target.cacheKey,
          weeks: WARM_WEEKS,
          location,
          entries,
          firstDate,
          lastDate,
          rows: rows.length,
          bytes: raw.length,
        }),
    );

    const datesWithCandleLighting = Object.values(times).filter((day) => day.candle_lighting).length;
    return {
      status: datesWithCandleLighting > 0 ? "warmed" : "warmed-no-candle-lighting",
      dates: rows.length,
      datesWithCandleLighting,
      lastDate,
    };
  } catch (cause) {
    return { status: "failed", error: cause instanceof Error ? cause.message : String(cause) };
  }
}
