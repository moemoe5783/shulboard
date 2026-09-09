import { NextResponse } from "next/server";
import { fetchChabadZmanim } from "@/lib/zmanim/chabad-adapter";
import { resolveChabadLocation, type ChabadLocation } from "@/lib/zmanim/location";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * The Chabad cache-warming cron — plan.md §5c: "Warm 90 days ahead on a
 * cron; bundle reads from cache only, never calls a provider inline."
 *
 * ONCE DAILY, not the build worker's 5 minutes (app/api/cron/build-bundles).
 * That route polls fast because a gabbai fixing a davening time before
 * Mincha needs it live; this one is warming 90 days of an unofficial,
 * undocumented endpoint that doesn't need or want to be hit every five
 * minutes — daily is already generous against how slowly candle-lighting
 * minutes actually change, and it's kinder to an endpoint this project has
 * no ToS with (plan.md §10.4).
 *
 * SEVENTH NAMED SERVICE-ROLE EXCEPTION — CLAUDE.md's list of exactly six
 * places has been updated to seven for this route; see that file.
 *
 * OFF BY DEFAULT. ZMANIM_CHABAD_ENABLED (docs/environment.md) gates the
 * whole handler, not just the org settings UI: even if a `zmanim_provider`
 * column somehow already says `'chabad'` for some row, this route does
 * nothing until the flag is explicitly on. That's the actual gate the
 * proposal's "off by default... until I turn it on myself" refers to — the
 * comments in lib/zmanim/chabad-adapter.ts about being unofficial and
 * provisional are documentation, not a runtime check, and this flag is the
 * runtime check they point at.
 *
 * Same CRON_SECRET as build-bundles (docs/environment.md) — one shared
 * secret between an external scheduler and every cron route in this
 * product, not a second one to provision and keep in sync.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WARM_DAYS_AHEAD = 90;

type OrgRow = { id: string; timezone: string; zmanim_provider: string; postal_code: string | null; zmanim_location_id: string | null };
type ScreenRow = {
  id: string;
  timezone: string | null;
  zmanim_provider: string | null;
  postal_code: string | null;
  zmanim_location_id: string | null;
  orgs: { timezone: string; zmanim_provider: string; postal_code: string | null; zmanim_location_id: string | null } | null;
};

/** One location worth warming, plus a timezone to render `display` strings
 *  in — whichever org/screen resolved to it first. Real shuls sharing a
 *  ZIP share a timezone in every case that matters here; this doesn't try
 *  to be more precise than that. */
type WarmTarget = ChabadLocation & { timezone: string };

function collectTargets(orgs: OrgRow[], screens: ScreenRow[]): Map<string, WarmTarget> {
  const targets = new Map<string, WarmTarget>();

  const consider = (provider: string, timezone: string | null, location: ChabadLocation | null) => {
    if (provider !== "chabad" || !location || !timezone) return;
    if (!targets.has(location.cacheKey)) targets.set(location.cacheKey, { ...location, timezone });
  };

  for (const org of orgs) {
    consider(
      org.zmanim_provider,
      org.timezone,
      resolveChabadLocation({ orgPostalCode: org.postal_code, orgZmanimLocationId: org.zmanim_location_id }),
    );
  }

  for (const screen of screens) {
    const provider = screen.zmanim_provider ?? screen.orgs?.zmanim_provider ?? "hebcal";
    const timezone = screen.timezone ?? screen.orgs?.timezone ?? null;
    consider(
      provider,
      timezone,
      resolveChabadLocation({
        screenPostalCode: screen.postal_code,
        orgPostalCode: screen.orgs?.postal_code,
        screenZmanimLocationId: screen.zmanim_location_id,
        orgZmanimLocationId: screen.orgs?.zmanim_location_id,
      }),
    );
  }

  return targets;
}

async function handleWarmRequest(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const offered = request.headers.get("authorization");
  if (!secret || offered !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  // Not a smaller version of the feature turned on halfway — a straight
  // no-op, same shape CRON_SECRET's own absence gives build-bundles.
  if (process.env.ZMANIM_CHABAD_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, warmed: 0 });
  }

  const db = serviceClientOrNull();
  if (!db) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const [{ data: orgs, error: orgsError }, { data: screens, error: screensError }] = await Promise.all([
    db.from("orgs").select("id, timezone, zmanim_provider, postal_code, zmanim_location_id"),
    db
      .from("screens")
      .select(
        "id, timezone, zmanim_provider, postal_code, zmanim_location_id, orgs(timezone, zmanim_provider, postal_code, zmanim_location_id)",
      )
      .eq("is_active", true),
  ]);

  if (orgsError) return NextResponse.json({ error: orgsError.message }, { status: 502 });
  if (screensError) return NextResponse.json({ error: screensError.message }, { status: 502 });

  const targets = collectTargets((orgs ?? []) as OrgRow[], (screens ?? []) as unknown as ScreenRow[]);

  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const endDate = new Date(today.getTime() + WARM_DAYS_AHEAD * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  /*
   * Three outcomes, not two — mirroring build-bundles' own
   * built/unchanged/failed rather than collapsing anything into "failed":
   *
   * - "warmed": the fetch succeeded and at least one day in the window
   *   carried a `candle_lighting` value.
   * - "warmed-no-candle-lighting": the fetch and parse both succeeded and
   *   the endpoint simply had nothing to light across the whole window.
   *   This is NOT a failure. Plenty of individual days legitimately have no
   *   candle lighting — an ordinary Thursday, or the second night of a
   *   two-day Yom Tov, which chabad.org reports as `ShabbatEndTime` and the
   *   adapter deliberately excludes (test/fixtures/chabad-zmanim-33710-
   *   sep2026.json's 9/12 entry). Over 90 days, though, zero is a different
   *   claim from "this Thursday has none": a real location always has
   *   Fridays in a 90-day window, so zero across the whole span is the
   *   signature of a silent response-shape regression — exactly what bit
   *   this adapter this week, when `item.Date` parsing skipped every day
   *   and nothing anywhere said so. Distinguishing it is the point: a
   *   reader of this route's own output can tell "fetched fine, nothing to
   *   light" from "the fetch broke," and can tell either from a healthy run.
   * - "failed": the fetch threw, the response wasn't ok, or the upsert
   *   errored. An actual error, with its message.
   *
   * Rows are still written in every non-failed case, `times: {}` and all —
   * an empty day is a real, cacheable answer, and the untouched
   * `raw_response` beside it is what makes a shape regression diagnosable
   * at all.
   */
  const results: {
    cacheKey: string;
    status: "warmed" | "warmed-no-candle-lighting" | "failed";
    days?: number;
    daysWithCandleLighting?: number;
    error?: string;
  }[] = [];

  // Serially, same reasoning as build-bundles: this is a small, deduped list
  // (twenty Crown Heights shuls collapse to one target — plan.md §5c's own
  // point of the cache), and an undocumented endpoint is exactly the kind
  // this project should not hammer concurrently.
  for (const target of targets.values()) {
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
        const { error } = await db.from("zmanim_cache").upsert(rows, { onConflict: "provider,location_id,date" });
        if (error) throw new Error(error.message);
      }

      const daysWithCandleLighting = Object.values(times).filter((day) => day.candle_lighting).length;
      results.push({
        cacheKey: target.cacheKey,
        status: daysWithCandleLighting > 0 ? "warmed" : "warmed-no-candle-lighting",
        days: rows.length,
        daysWithCandleLighting,
      });
    } catch (cause) {
      results.push({
        cacheKey: target.cacheKey,
        status: "failed",
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return NextResponse.json({
    enabled: true,
    targets: targets.size,
    warmed: results.filter((r) => r.status === "warmed").length,
    // Counted separately from both — a caller watching this route can alert
    // on `failed` for breakage and on a persistently non-zero
    // `warmedNoCandleLighting` for a shape regression, which are different
    // problems with different fixes.
    warmedNoCandleLighting: results.filter((r) => r.status === "warmed-no-candle-lighting").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}

export const GET = handleWarmRequest;
export const POST = handleWarmRequest;
