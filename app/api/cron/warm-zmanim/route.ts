import { NextResponse } from "next/server";
import { resolveChabadLocation, type ChabadLocation } from "@/lib/zmanim/location";
import { warmChabadLocation } from "@/lib/zmanim/warm";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * The Chabad cache-warming cron — plan.md §5c: "bundle reads from cache
 * only, never calls a provider inline."
 *
 * ONCE DAILY, not the build worker's 5 minutes (app/api/cron/build-bundles).
 * That route polls fast because a gabbai fixing a davening time before
 * Mincha needs it live; this one refreshes 92 days of zmanim, none of
 * which changes from one hour to the next. Daily is generous against how
 * slowly those minutes move, and it is a courtesy to an endpoint this
 * product is a guest on.
 *
 * Daily still matters for coverage and not only for freshness, just far
 * less urgently than it did when the window was four weeks: each run
 * slides a 92-day window forward, so the schedule can lapse for weeks
 * before any date starts falling through to Hebcal. See WARM_DAYS in
 * lib/zmanim/warm.ts.
 *
 * A NAMED SERVICE-ROLE EXCEPTION — see CLAUDE.md's list. This route needs
 * the key for its own reason, separate from the warming it delegates: it
 * sweeps EVERY org and screen to discover which locations are referenced
 * at all, which is a cross-tenant read no RLS policy can express. The
 * write into `zmanim_cache` is `lib/zmanim/warm.ts`'s, shared with the
 * settings page's own "Fetch now" button so there is one copy of it.
 *
 * OFF BY DEFAULT. ZMANIM_CHABAD_ENABLED (docs/environment.md) gates the
 * whole handler, not just the org settings UI: even if a `zmanim_provider`
 * column somehow already says `'chabad'` for some row, this route does
 * nothing until the flag is explicitly on. That's the actual gate the
 * proposal's "off by default... until I turn it on myself" refers to.
 *
 * The source it warms from is Chabad.org's Get_Zmanim endpoint
 * (lib/zmanim/chabad-adapter.ts), which returns all thirteen daily zmanim
 * and candle lighting for the whole 92 days in one request. The published
 * candle-lighting embed is kept as an unwired fallback
 * (lib/zmanim/chabad-embed.ts) and covers only four weeks of candle
 * lighting.
 *
 * Same CRON_SECRET as build-bundles (docs/environment.md) — one shared
 * secret between an external scheduler and every cron route in this
 * product, not a second one to provision and keep in sync.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // Three outcomes per target, not two — the distinction between "fetched
  // fine, nothing to light" and "the fetch broke" is made in
  // lib/zmanim/warm.ts, which explains why zero candle lightings across
  // the whole 92-day window is a signal rather than a failure. This route
  // only counts them up.
  //
  // `requestedEndDate` and `echoedEndDate` are both reported because the
  // 92-day span is verified rather than known to be a ceiling — if
  // chabad.org ever starts coercing it, the two disagree here instead of
  // the cache going quietly short. `zmanIds` is reported so a mapping
  // regression shows up in this JSON and not only in a log line.
  const results: {
    cacheKey: string;
    status: "warmed" | "warmed-no-candle-lighting" | "failed";
    dates?: number;
    datesWithCandleLighting?: number;
    lastDate?: string | null;
    requestedEndDate?: string;
    echoedEndDate?: string | null;
    zmanIds?: string[];
    error?: string;
  }[] = [];

  // Serially, same reasoning as build-bundles: this is a small, deduped list
  // (twenty Crown Heights shuls collapse to one target — plan.md §5c's own
  // point of the cache), and an endpoint this product is a guest on is not
  // one to hit concurrently — the more so now that each call is a 92-day
  // ~105KB response rather than a 6KB one.
  for (const target of targets.values()) {
    results.push({ cacheKey: target.cacheKey, ...(await warmChabadLocation(target)) });
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
