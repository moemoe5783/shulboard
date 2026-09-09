import "server-only";
import { parseZmanTime, zonedTimeToUtc } from "./time.ts";

/*
 * Chabad.org's undocumented Get_Zmanim endpoint, read into this project's
 * own `{iso, display}` vocabulary — plan.md §5c.
 *
 * NOT WIRED TO ANYTHING. THIS IS NOT DEAD CODE, AND IT IS NOT THE CANDLE
 * LIGHTING PATH ANY MORE.
 *
 * plan.md §10.4's conversation happened. Asked directly, Chabad.org
 * pointed at their PUBLISHED candle-lighting embed rather than at this
 * endpoint, so candle lighting now goes through `chabad-embed.ts` — a
 * supported, public integration surface with an attribution condition —
 * and nothing calls this module. That closes §10.4 for candle lighting.
 *
 * It is kept, rather than deleted, because it remains the only source
 * anyone has found for Chabad-sourced zmanim BEYOND candle lighting: alos,
 * netz, the shma and tfila deadlines, shkia, tzeis — the thirteen types
 * the captured JSON response carries on every day. That is a separate,
 * still-unresolved conversation (plan.md §5c): the published alternative
 * is a zmanim RSS feed that returns one day only, with no date parameter,
 * so it cannot fill a 90-day cache. Until that is settled, this endpoint
 * stays undocumented and unsanctioned and this module stays uncalled —
 * wiring it back up is a decision about permission, not a refactor.
 *
 * `ZMANIM_CHABAD_ENABLED` (docs/environment.md) still gates the whole
 * Chabad provider, embed included.
 *
 * THE RESPONSE SHAPE BELOW IS CONFIRMED, not reconstructed — checked by
 * hand against a real 4-day response for ZIP 33710 (Thu 9/10/2026 through
 * Sun 9/13/2026, spanning an ordinary Thursday and Erev/both days of Rosh
 * Hashanah), test/fixtures/chabad-zmanim-33710-sep2026.json, exercised by
 * scripts/test-chabad-adapter.ts. Two things that real response corrected
 * from an earlier, unverified version of this file:
 *
 * 1. The match key is `item.ZmanType`, an exact machine-readable enum
 *    (`"CandleLighting"`), not a substring guess over `Name`/`Caption`/
 *    `Title`/`Type`. The fixture's own 9/12 entry — `Title: "Candle
 *    Lighting after"`, `ZmanType: "ShabbatEndTime"`,
 *    `FootnoteType: "LightCandlesAfter"` — is exactly the item a
 *    substring-on-Title match would have wrongly matched: it is the
 *    second night of a two-day Yom Tov, when candles are lit only after
 *    nightfall from an existing flame, not the regular pre-sunset
 *    candle-lighting `CandleLighting` items carry. Matching on `ZmanType`
 *    excludes it by construction. THIS EXCLUSION IS DELIBERATE, not a gap
 *    discovered later: this adapter does not attempt second-night/
 *    "light after" candle lighting at all yet. See isCandleLightingItem's
 *    own comment.
 * 2. `item.Date` is not a timestamp — every item within one day shares
 *    the identical `/Date(...)/` value regardless of that item's own time
 *    of day (confirmed: every item on 9/11 carries `/Date(1789099200000)/`
 *    whether it's a 5:59 AM or an 8:05 PM zman), and it isn't even the
 *    same value as that day's own `GmtDate`. It cannot be used to build
 *    the instant. The real instant is built from three things instead:
 *    the calendar date, from the DAY's own `DisplayDate` ("9/11/2026" —
 *    unambiguous and per-day, unlike the shared, GMT-anchored `Date`/
 *    `GmtDate` fields); the time of day, parsed out of the item's own
 *    `Zman` string ("7:22 PM" — a plain rendered time, not a date at
 *    all); and the org/screen's own stored IANA timezone, already a
 *    parameter to this function. Chabad's `LocationDetails` field (e.g.
 *    "-5 GMT | DST in effect") was deliberately NOT used for this: it is
 *    one fixed offset for the whole response, with no per-day breakdown,
 *    so a request spanning a DST transition has no way to tell from that
 *    field alone which of its days the offset actually applies to. The
 *    org/screen's own IANA timezone (which already knows its own DST
 *    rules for any date) is the only one of the three inputs reliable
 *    enough to use for this.
 */

const ENDPOINT = "https://www.chabad.org/webservices/zmanim/zmanim/Get_Zmanim";

export type ChabadZman = { iso: string; display: string };

export type ChabadZmanimResult = {
  /** Canonical zman id -> value. Only `candle_lighting` today (plan §5c's
   *  own spelling) — the one thing widgets/candle-lighting needs. */
  times: Record<string, Record<string, ChabadZman>>;
  /** The untouched fetch body, one entry per returned day, keyed the same
   *  way `times` is. Stored verbatim in zmanim_cache.raw_response — this
   *  endpoint can change shape with no notice, and this is the only way to
   *  tell why a mapping started coming back empty. */
  rawResponseByDate: Record<string, unknown>;
};

/** "9/11/2026" -> {year, month, day}. The per-DAY calendar date — see this
 *  file's header comment on why this, and not either of the two
 *  GMT-anchored `Date`/`GmtDate` fields, is what the instant is built
 *  from. */
function parseDisplayDate(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  return { month: Number(match[1]), day: Number(match[2]), year: Number(match[3]) };
}

/**
 * Exact match on `ZmanType`, nothing looser. See this file's header
 * comment for the real response that replaced an earlier substring guess
 * over `Name`/`Caption`/`Title`/`Type`, and for why this deliberately
 * excludes "Candle Lighting after" (`ZmanType: "ShabbatEndTime"`,
 * `FootnoteType: "LightCandlesAfter"`) — the second-night candle lighting
 * of a two-day Yom Tov, lit after nightfall from an existing flame rather
 * than before sunset. That case is known and excluded by this exact match,
 * not missed: this adapter does not attempt it yet.
 */
function isCandleLightingItem(item: Record<string, unknown>): boolean {
  return item.ZmanType === "CandleLighting";
}

function formatDisplay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

/**
 * One line per request, at `console.info` so it lands in Vercel's function
 * logs without a log-level flag.
 *
 * WHY THIS EXISTS: a live 91-day warm for ZIP 33710 came back with 91 days
 * and zero candle-lighting times. The warming code's own alarm caught it
 * (lib/zmanim/warm.ts's `warmed-no-candle-lighting`), but the alarm can
 * only say "zero" — it cannot say whether the request was malformed, the
 * range was honoured, or the response shape changed. Every field below is
 * chosen to answer one of those without a second guess:
 *
 * - the full URL, so a wrong date format or a missing parameter is visible
 *   rather than inferred (the three date parameters are the live suspects —
 *   the hand-verified working request uses M-D-YYYY for `tdate` and
 *   M/D/YYYY for `startdate`/`enddate`, and this code sends ISO for all
 *   three);
 * - status and byte length, which separate a truncated or error body from
 *   a full one;
 * - `days`, plus the FIRST and LAST `DisplayDate`, which is what actually
 *   says whether chabad.org honoured the range it was asked for or
 *   substituted its own — a count alone cannot tell those apart;
 * - the range chabad.org echoes back in its own top-level `EndDate` /
 *   `GmtStartDate` / `GmtEndDate`, its side of the same question;
 * - every distinct `ZmanType` across the whole response, so a changed
 *   vocabulary is obvious (the fixture's own set is 13 halachic types plus
 *   `CandleLighting` and `ShabbatEndTime`);
 * - and the dates that carried a `CandleLighting`, not just how many.
 *   WHICH days is the discriminating fact: candle lighting on every Friday
 *   in the range is a working response, candle lighting only on the `tdate`
 *   day means one wide request can never return more than one and the
 *   whole 91-day-single-fetch approach is wrong.
 *
 * Deliberately not logged: the response body. It is up to a megabyte at 91
 * days, it is already stored verbatim in `zmanim_cache.raw_response` where
 * it can be read at leisure, and a log line nobody can scroll through is
 * not a diagnostic.
 */
function logRequest(url: URL, status: number, bytes: number, body: unknown, days: unknown[]): void {
  const record = (body ?? {}) as Record<string, unknown>;
  const displayDates = days.map((day) => (day as Record<string, unknown>)?.DisplayDate);

  const zmanTypes = new Set<string>();
  const candleLightingDates: unknown[] = [];

  for (const day of days) {
    const dayRecord = (day ?? {}) as Record<string, unknown>;
    let hasCandleLighting = false;
    for (const group of Array.isArray(dayRecord.TimeGroups) ? dayRecord.TimeGroups : []) {
      for (const item of Array.isArray((group as Record<string, unknown>)?.Items)
        ? ((group as Record<string, unknown>).Items as unknown[])
        : []) {
        const type = (item as Record<string, unknown>)?.ZmanType;
        if (typeof type === "string") {
          zmanTypes.add(type);
          if (type === "CandleLighting") hasCandleLighting = true;
        }
      }
    }
    if (hasCandleLighting) candleLightingDates.push(dayRecord.DisplayDate);
  }

  console.info(
    "[chabad-zmanim] " +
      JSON.stringify({
        url: url.toString(),
        status,
        bytes,
        days: days.length,
        firstDisplayDate: displayDates[0] ?? null,
        lastDisplayDate: displayDates[displayDates.length - 1] ?? null,
        echoedLocation: record.LocationName ?? null,
        echoedLocationId: record.LocationId ?? null,
        echoedEndDate: record.EndDate ?? null,
        echoedGmtStartDate: record.GmtStartDate ?? null,
        echoedGmtEndDate: record.GmtEndDate ?? null,
        zmanTypes: [...zmanTypes].sort(),
        candleLightingDates,
      }),
  );
}

/**
 * One (chabad, location) pair's zmanim for the given date range, ready to
 * upsert into `zmanim_cache` one row per date.
 *
 * `timeZone` is the org/screen's own stored IANA zone — used both to build
 * the actual instant (see this file's header comment) and to render
 * `display` the way this project's own `formatTimeOfDay` would
 * (lib/hebrew/format.ts). Plan §5c's "never re-round or recompute provider
 * output" is about the *value*, not its string rendering, and Chabad's own
 * rendered string isn't reachable from this endpoint's raw items the way
 * it is from their HTML pages, so this project renders it instead of
 * inventing a second display convention.
 */
export async function fetchChabadZmanim(input: {
  locationId: string;
  locationType: "1" | "2";
  startDate: string;
  endDate: string;
  timeZone: string;
}): Promise<ChabadZmanimResult> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("locationid", input.locationId);
  url.searchParams.set("locationtype", input.locationType);
  url.searchParams.set("save", "1");
  url.searchParams.set("tdate", input.startDate);
  url.searchParams.set("startdate", input.startDate);
  url.searchParams.set("enddate", input.endDate);
  url.searchParams.set("jewish", "Zmanim-Halachic-Times.htm");
  // Deliberately no `aid` parameter — confirmed by hand not to be required.

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    console.error(`[chabad-zmanim] ${response.status} ${response.statusText} for ${url.toString()}`);
    throw new Error(`Chabad zmanim request failed: ${response.status} ${response.statusText}`);
  }

  // Read as text, not `.json()`, for two reasons: the byte length is part of
  // what the log below has to report, and a body that isn't JSON at all
  // becomes a diagnosable error with a snippet rather than an opaque throw.
  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    console.error(
      `[chabad-zmanim] 200 but unparseable body, ${raw.length} bytes, for ${url.toString()} — starts: ${JSON.stringify(raw.slice(0, 200))}`,
    );
    throw new Error("Chabad zmanim response was not JSON");
  }

  const days = Array.isArray((body as { Days?: unknown[] })?.Days) ? (body as { Days: unknown[] }).Days : [];

  logRequest(url, response.status, raw.length, body, days);

  const times: Record<string, Record<string, ChabadZman>> = {};
  const rawResponseByDate: Record<string, unknown> = {};

  for (const day of days) {
    const dayRecord = day as Record<string, unknown>;
    const calendarDate = parseDisplayDate(dayRecord.DisplayDate);
    if (!calendarDate) continue;
    const isoDate = `${calendarDate.year}-${String(calendarDate.month).padStart(2, "0")}-${String(calendarDate.day).padStart(2, "0")}`;

    rawResponseByDate[isoDate] = day;

    const groups = Array.isArray(dayRecord.TimeGroups) ? (dayRecord.TimeGroups as unknown[]) : [];
    for (const group of groups) {
      const items = Array.isArray((group as Record<string, unknown>).Items)
        ? ((group as Record<string, unknown>).Items as unknown[])
        : [];
      for (const rawItem of items) {
        const item = rawItem as Record<string, unknown>;
        if (!isCandleLightingItem(item)) continue;
        const time = parseZmanTime(item.Zman);
        if (!time) continue;

        const instant = zonedTimeToUtc(
          calendarDate.year,
          calendarDate.month,
          calendarDate.day,
          time.hour,
          time.minute,
          input.timeZone,
        );
        times[isoDate] ??= {};
        times[isoDate].candle_lighting = { iso: instant.toISOString(), display: formatDisplay(instant, input.timeZone) };
      }
    }
  }

  return { times, rawResponseByDate };
}
