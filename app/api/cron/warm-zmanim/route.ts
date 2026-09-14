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
 * Mincha needs it live; this one refreshes zmanim, which don't change from
 * one hour to the next. Daily is generous against how slowly those minutes
 * move, and it is a courtesy to an endpoint this product is a guest on.
 *
 * DAILY IS NOW LOAD-BEARING FOR COVERAGE, not only freshness. The source is
 * the published RSS feed (lib/zmanim/chabad-rss.ts), which returns TODAY
 * only — no date range — so each run covers exactly one day. A day the cron
 * doesn't run is a day with no zmanim once every screen's existing bundle
 * rolls past it. That is the accepted trade for US-only-for-now; the 92-day
 * Get_Zmanim reader is kept unwired (lib/zmanim/chabad-adapter.ts) for the
 * day range matters again.
 *
 * A NAMED SERVICE-ROLE EXCEPTION — see CLAUDE.md's list. This route needs
 * the key for its own reason, separate from the warming it delegates: it
 * sweeps EVERY org and screen to discover which locations are referenced
 * at all, which is a cross-tenant read no RLS policy can express. The
 * write into `zmanim_cache` is `lib/zmanim/warm.ts`'s, shared with the
 * settings page's "Use this address" action so there is one copy of it.
 *
 * OFF BY DEFAULT. ZMANIM_CHABAD_ENABLED (docs/environment.md) gates the
 * whole handler, not just the org settings UI: even if a `zmanim_provider`
 * column somehow already says `'chabad'` for some row, this route does
 * nothing until the flag is explicitly on. That's the actual gate the
 * proposal's "off by default... until I turn it on myself" refers to.
 *
 * Same CRON_SECRET as build-bundles (docs/environment.md) — one shared
 * secret between an external scheduler and every cron route in this
 * product, not a second one to provision and keep in sync.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type OrgRow = {
  id: string;
  timezone: string;
  zmanim_provider: string;
  postal_code: string | null;
  zmanim_location_id: string | null;
  zmanim_location_type: string | null;
  zmanim_location_name: string | null;
};
type ScreenRow = {
  id: string;
  timezone: string | null;
  zmanim_provider: string | null;
  postal_code: string | null;
  /* `screens` carries an id and no type or name — those two columns are
     org-level only, because there is no screen-level zmanim settings form
     to write them and adding columns nothing writes is how a schema grows
     dead weight. A screen id therefore resolves as a legacy bare id
     (locationtype 1, unverifiable), which lib/zmanim/location.ts documents
     and which no UI can currently produce. */
  zmanim_location_id: string | null;
  orgs: {
    timezone: string;
    zmanim_provider: string;
    postal_code: string | null;
    zmanim_location_id: string | null;
    zmanim_location_type: string | null;
    zmanim_location_name: string | null;
  } | null;
};

/** One location worth warming, plus a timezone to render `display` strings
 *  in — whichever org/screen resolved to it first. Real shuls sharing a
 *  ZIP share a timezone in every case that matters here; this doesn't try
 *  to be more precise than that. */
type WarmTarget = ChabadLocation & { timezone: string };

function collectTargets(orgs: OrgRow[], screens: ScreenRow[]): Map<string, WarmTarget> {
  const targets = new Map<string, WarmTarget>();

  /*
   * NO PROVIDER TEST ANY MORE. This used to skip any org or screen whose
   * `zmanim_provider` wasn't `'chabad'`; Chabad.org is now the only source
   * (lib/zmanim/provider.ts), so every location any org or screen resolves
   * to is worth warming — including the orgs still sitting on the schema's
   * `'hebcal'` default, which are exactly the ones that would otherwise
   * have a board with no data.
   *
   * A location and a timezone are still required, and a shul with neither
   * a ZIP nor a manual id is simply not warmable — its widgets say so
   * themselves.
   */
  const consider = (timezone: string | null, location: ChabadLocation | null) => {
    if (!location || !timezone) return;
    if (!targets.has(location.cacheKey)) targets.set(location.cacheKey, { ...location, timezone });
  };

  for (const org of orgs) {
    consider(
      org.timezone,
      resolveChabadLocation({
        orgPostalCode: org.postal_code,
        orgZmanimLocationId: org.zmanim_location_id,
        orgZmanimLocationType: org.zmanim_location_type,
        orgZmanimLocationName: org.zmanim_location_name,
      }),
    );
  }

  for (const screen of screens) {
    const timezone = screen.timezone ?? screen.orgs?.timezone ?? null;
    consider(
      timezone,
      resolveChabadLocation({
        screenPostalCode: screen.postal_code,
        orgPostalCode: screen.orgs?.postal_code,
        screenZmanimLocationId: screen.zmanim_location_id,
        orgZmanimLocationId: screen.orgs?.zmanim_location_id,
        orgZmanimLocationType: screen.orgs?.zmanim_location_type,
        orgZmanimLocationName: screen.orgs?.zmanim_location_name,
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
    db.from("orgs").select("id, timezone, zmanim_provider, postal_code, zmanim_location_id, zmanim_location_type, zmanim_location_name"),
    db
      .from("screens")
      .select(
        "id, timezone, zmanim_provider, postal_code, zmanim_location_id, orgs(timezone, zmanim_provider, postal_code, zmanim_location_id, zmanim_location_type, zmanim_location_name)",
      )
      .eq("is_active", true),
  ]);

  if (orgsError) return NextResponse.json({ error: orgsError.message }, { status: 502 });
  if (screensError) return NextResponse.json({ error: screensError.message }, { status: 502 });

  const targets = collectTargets((orgs ?? []) as OrgRow[], (screens ?? []) as unknown as ScreenRow[]);

  // Two outcomes per target now — the RSS feed is a single day, so "no
  // candle lighting today" is ordinary (most days have none) rather than the
  // 92-day "zero Fridays is a shape regression" alarm the JSON adapter
  // watched for. `zmanIds` is reported so a mapping regression shows up in
  // this JSON and not only in a log line.
  const results: {
    cacheKey: string;
    status: "warmed" | "failed";
    dates?: number;
    hasCandleLighting?: boolean;
    date?: string | null;
    zmanIds?: string[];
    /** Screens whose bundle this warm queued for a rebuild. ZERO ON A
     *  LOCATION A SHUL ACTUALLY USES IS THE ALARM — see
     *  lib/zmanim/warm.ts's `queueRebuildsForCacheKey`: the cache is read
     *  at build time and frozen into the bundle, so a warm that queues
     *  nothing changes nothing any screen shows. */
    screensQueued?: number;
    error?: string;
  }[] = [];

  // Serially, same reasoning as build-bundles: this is a small, deduped list
  // (twenty Crown Heights shuls collapse to one target — plan.md §5c's own
  // point of the cache), and an endpoint this product is a guest on is not
  // one to hit concurrently.
  for (const target of targets.values()) {
    results.push({ cacheKey: target.cacheKey, ...(await warmChabadLocation(target)) });
  }

  return NextResponse.json({
    enabled: true,
    targets: targets.size,
    warmed: results.filter((r) => r.status === "warmed").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}

export const GET = handleWarmRequest;
export const POST = handleWarmRequest;
