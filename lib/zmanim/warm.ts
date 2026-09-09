import "server-only";
import { fetchChabadZmanim } from "./chabad-adapter";
import type { ChabadLocation } from "./location";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * Warming one (chabad, location) pair into `zmanim_cache` — plan.md §5c's
 * "warm 90 days ahead on a cron; bundle reads from cache only, never calls
 * a provider inline."
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

/** Chabad's own endpoint decides nothing here; 90 days is plan.md §5c's
 *  figure, and it is what makes an unplugged screen able to come back on
 *  its own within three months (§3b). */
const WARM_DAYS_AHEAD = 90;

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
       * Over 90 days, though, zero is a different claim from "this Thursday
       * has none": a real location always has Fridays in a 90-day window,
       * so zero across the whole span is the signature of a silent
       * response-shape regression — exactly what bit this adapter, when
       * `item.Date` parsing skipped every day and nothing anywhere said so.
       * Telling the two apart is the point, for the cron's JSON and for the
       * gabbai reading the settings page's own "Fetch now" line alike.
       */
      status: "warmed" | "warmed-no-candle-lighting";
      days: number;
      daysWithCandleLighting: number;
    }
  | { status: "failed"; error: string };

/**
 * Fetches and upserts 90 days for one location. Never throws: every caller
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

  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const endDate = new Date(today.getTime() + WARM_DAYS_AHEAD * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  try {
    const { times, rawResponseByDate } = await fetchChabadZmanim({
      locationId: target.locationId,
      locationType: target.locationType,
      startDate,
      endDate,
      timeZone: target.timezone,
    });

    const rows = Object.keys(rawResponseByDate).map((date) => ({
      provider: "chabad" as const,
      location_id: target.cacheKey,
      date,
      timezone: target.timezone,
      times: times[date] ?? {},
      raw_response: rawResponseByDate[date] as never,
      fetched_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await db
        .from("zmanim_cache")
        .upsert(rows, { onConflict: "provider,location_id,date" });
      if (error) throw new Error(error.message);
    }

    const daysWithCandleLighting = Object.values(times).filter((day) => day.candle_lighting).length;
    return {
      status: daysWithCandleLighting > 0 ? "warmed" : "warmed-no-candle-lighting",
      days: rows.length,
      daysWithCandleLighting,
    };
  } catch (cause) {
    return { status: "failed", error: cause instanceof Error ? cause.message : String(cause) };
  }
}
