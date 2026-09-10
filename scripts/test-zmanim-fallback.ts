/**
 * lib/zmanim/resolve.ts — candle lighting, resolved: which dates want one,
 * and which of those Chabad actually published.
 *
 * NO FALLBACK LEG LEFT TO TEST, and this suite keeps its name because what
 * it guards is the same decision point. §5c's chain used to read "requested
 * provider → cache → Hebcal (client-side, always works)". The Hebcal leg is
 * gone: Chabad.org is the only source (lib/zmanim/provider.ts), and a date
 * it has no value for resolves to `unavailable` rather than to a computed
 * stand-in. So what this suite now asserts is the sharper claim — that a
 * time on a board is ALWAYS Chabad's, and that the dates and labels around
 * it are always @hebcal/core's.
 *
 * THAT SPLIT IS THE POINT. @hebcal/core is still imported by the module
 * under test and that is not a leftover: it answers which dates are
 * candle-lighting dates and what a Yom Tov is called, neither of which a
 * cache of times can say. Hebcal is the calendar, Chabad is the clock.
 *
 * THE CACHE IS THE REAL ONE, loaded out of
 * test/fixtures/chabad-zmanim-33701-92day.json through the real Get_Zmanim
 * reader — the same code path that fills `zmanim_cache` in production
 * (lib/zmanim/warm.ts).
 *
 * Run with: npm run test:zmanim-fallback — not plain `node`. Loading the
 * fixture through the adapter means importing a module that imports
 * `server-only`, which throws unless the `react-server` export condition is
 * set (see the npm script).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BoardLocation } from "../lib/board-location.tsx";
import { upcomingCandleLighting, upcomingCandleLightings } from "../lib/hebrew/candle-times.ts";
import { fetchChabadZmanim } from "../lib/zmanim/chabad-adapter.ts";
import {
  WEEK_DAYS,
  resolveCandleLighting,
  resolveCandleLightings,
  type ChabadZmanimByDate,
} from "../lib/zmanim/resolve.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

// Saint Petersburg, FL — the fixture's own location, so a hebcal-computed
// date and a Chabad-published time describe the same place.
const LOCATION: BoardLocation = {
  latitude: 27.7723,
  longitude: -82.6386,
  timeZone: "America/New_York",
};

const FIXTURE_PATH = fileURLToPath(new URL("../test/fixtures/chabad-zmanim-33701-92day.json", import.meta.url));
const FIXTURE = readFileSync(FIXTURE_PATH, "utf8");

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => ({
  ok: true,
  status: 200,
  statusText: "OK",
  text: async () => FIXTURE,
})) as unknown as typeof fetch;
const { times: CACHE } = await fetchChabadZmanim({
  locationId: "33701",
  locationType: "2",
  startDate: "2026-09-10",
  endDate: "2026-12-10",
  timeZone: "America/New_York",
});
globalThis.fetch = originalFetch;

const iso = (d: Date) => d.toISOString();
const cache = CACHE as ChabadZmanimByDate;

console.log("\n-- the fixture, through the real reader ---------------------");

check(
  "candle_lighting" in (CACHE["2026-09-11"] ?? {}),
  "9/11 (Erev Rosh Hashanah) carries a candle lighting",
);
check(
  CACHE["2026-09-12"] !== undefined && !("candle_lighting" in CACHE["2026-09-12"]),
  "9/12 IS in the cache with its other zmanim and has no candle_lighting — the second night of a two-day Yom Tov",
  `${Object.keys(CACHE["2026-09-12"] ?? {}).length} ids, candle_lighting absent`,
);
check(
  Object.keys(CACHE).sort().at(-1) === "2026-12-10",
  "and the cache ends at 12/10 — 92 days, nothing beyond",
  Object.keys(CACHE).sort().at(-1),
);

console.log("\n-- a time on a board is always Chabad's --------------------");

const happy = resolveCandleLighting({
  now: new Date("2026-09-11T16:00:00Z"),
  location: LOCATION,
  chabadZmanim: cache,
});
check(happy !== null && iso(happy.time) === "2026-09-11T23:22:00.000Z",
  "the value shown is Chabad's own 7:22 PM", happy && iso(happy.time));

// The single most important property, and the one an "is it equal to
// hebcal's" check would get wrong. Providers legitimately differ by a
// minute or two on the same date — §5c's whole reason for supporting more
// than one — so the lookup is by LOCAL CALENDAR DATE, never by instant.
// Hebcal's own answer here happens to be identical, so the fixture alone
// cannot prove it; a deliberately-offset copy can.
const hebcalHappy = upcomingCandleLighting(new Date("2026-09-11T16:00:00Z"), LOCATION);
check(
  hebcalHappy !== null && iso(hebcalHappy.eventTime) === "2026-09-11T23:21:00.000Z",
  "hebcal's own answer for the same date is a minute earlier — 7:21 PM against Chabad's 7:22",
  hebcalHappy && iso(hebcalHappy.eventTime),
);
check(
  happy !== null && hebcalHappy !== null && happy.time.getTime() !== hebcalHappy.eventTime.getTime(),
  "so this is not a case of the two agreeing: Chabad's value wins a real disagreement",
);
// Which is exactly why the lookup is by date rather than by instant — an
// instant comparison would read that one-minute difference as a miss and
// throw a perfectly good Chabad value away, and §5c supporting more than
// one provider is entirely because they differ by a minute or two.
const offset = resolveCandleLighting({
  now: new Date("2026-09-11T16:00:00Z"),
  location: LOCATION,
  chabadZmanim: {
    "2026-09-11": { candle_lighting: { iso: "2026-09-11T23:25:00.000Z", display: "7:25 PM" } },
  },
});
check(
  offset !== null && iso(offset.time) === "2026-09-11T23:25:00.000Z",
  "a Chabad value four minutes off hebcal's on the same date is KEPT, not discarded as a miss",
  offset && iso(offset.time),
);

console.log("\n-- hebcal is the calendar: the date, and the label ---------");

// The date about to happen is what decides which cache row matters, and a
// cache of times cannot supply it: a date with no row is indistinguishable
// from an ordinary Tuesday.
check(
  happy?.event !== undefined && happy?.event !== null,
  "every resolved entry carries the hebcal event for its date",
);
check(
  happy !== null && happy.event.renderBrief("en") === "Candle lighting",
  "9/11's own event names it",
  happy?.event.renderBrief("en"),
);
{
  /*
   * WHAT THE EVENT DOES NOT GIVE US, asserted so nobody re-adds the claim
   * this suite used to make. A `CandleLightingEvent`'s `renderBrief` is
   * "Candle lighting" on every one of them — Erev Yom Kippur included,
   * because the Yom Tov name lives on `linkedEvent` and not on the event.
   * So the event's real contribution is the localisation (Hebrew,
   * transliterated, or both per the widget's script setting), not the
   * occasion, and no board has ever shown "Erev Yom Kippur" here.
   *
   * 9/20 is Erev Yom Kippur, a Sunday, and it is in the week below.
   */
  const week = resolveCandleLightings({
    now: new Date("2026-09-19T12:00:00Z"),
    location: LOCATION,
    chabadZmanim: cache,
    days: WEEK_DAYS,
  });
  const labels = week.status === "ok" ? week.entries.map((entry) => entry.event.renderBrief("en")) : [];
  check(labels.length > 0 && labels.every((label) => label === "Candle lighting"),
    "including Erev Yom Kippur's, every event's brief label is the generic one",
    labels.join(" | "));
  check(
    week.status === "ok" && week.entries.some((entry) => entry.event.linkedEvent?.getDesc() === "Erev Yom Kippur"),
    "the occasion is on the event's linkedEvent, which is where a future change would read it from",
  );
}

console.log("\n-- a date Chabad has not published: unavailable ------------");

{
  // 9/12 — the second night of Rosh Hashanah. Chabad files it as a
  // ShabbatEndTime with a LightCandlesAfter footnote, so it never lands
  // under candle_lighting. There is nothing to compute in its place any
  // more, and the cache is NOT empty (it holds 9/11), which is exactly why
  // the trigger has to be "is this VALUE cached" and not "is this dict
  // empty".
  const secondNight = resolveCandleLighting({
    now: new Date("2026-09-12T16:00:00Z"),
    location: LOCATION,
    chabadZmanim: cache,
  });
  check(secondNight === null,
    "9/12's next lighting has no Chabad value, so nothing resolves — no computed 8:14 PM stands in");
  check(Object.keys(CACHE).length > 0,
    "and the cache it found nothing in is far from empty",
    `${Object.keys(CACHE).length} dates cached`);
}

{
  // Past the 92-day window. This used to be the "expected, flag it" case;
  // it is now simply the unavailable state, and so is every date a warm
  // missed. That makes the state common rather than rare.
  const past = resolveCandleLightings({
    now: new Date("2026-12-20T16:00:00Z"),
    location: LOCATION,
    chabadZmanim: cache,
    days: WEEK_DAYS,
  });
  check(past.status === "unavailable", "a week past the window is unavailable, not calculated", past.status);

  const single = resolveCandleLighting({
    now: new Date("2026-12-20T16:00:00Z"),
    location: LOCATION,
    chabadZmanim: cache,
  });
  check(single === null, "and the single-value resolver agrees");
}

{
  // An empty cache and a null cache are the same answer. A screen whose
  // cron has never run is the other common way to reach this.
  for (const [label, dict] of [
    ["an empty cache", {}],
    ["no cache at all", null],
  ] as [string, ChabadZmanimByDate | null][]) {
    const resolution = resolveCandleLightings({
      now: new Date("2026-09-11T16:00:00Z"),
      location: LOCATION,
      chabadZmanim: dict,
      days: WEEK_DAYS,
    });
    check(resolution.status === "unavailable", `${label}: unavailable`, resolution.status);
  }
}

console.log("\n-- multiple candle lightings in one week -------------------");

{
  // The week of 9/18: Friday 9/18 and Erev Yom Kippur on Sunday 9/20, both
  // published. This is the case the "all upcoming" display mode exists for,
  // and the single-value resolver cannot express it.
  const week = resolveCandleLightings({
    now: new Date("2026-09-17T12:00:00Z"),
    location: LOCATION,
    chabadZmanim: cache,
    days: WEEK_DAYS,
  });
  check(week.status === "ok" && week.entries.length === 2,
    "the week of 9/18 has TWO — Friday 9/18 and Erev Yom Kippur Sunday 9/20",
    week.status === "ok" ? String(week.entries.length) : week.status);
  check(
    week.status === "ok" &&
      week.entries.map((entry) => iso(entry.time)).join(" ") ===
        "2026-09-18T23:14:00.000Z 2026-09-20T23:11:00.000Z",
    "in order, and both are Chabad's own values",
    week.status === "ok" ? week.entries.map((entry) => iso(entry.time)).join(" ") : week.status,
  );
}

{
  // And an ordinary week has one. THE COUNT VARYING is the whole reason
  // "all upcoming" is a hug-mode widget (sizing.md §2's "content whose
  // amount, not whose row design, changes at runtime") rather than a fit-
  // or fixed-mode one.
  const quiet = resolveCandleLightings({
    now: new Date("2026-09-21T12:00:00Z"),
    location: LOCATION,
    chabadZmanim: cache,
    days: WEEK_DAYS,
  });
  const busy = resolveCandleLightings({
    now: new Date("2026-09-17T12:00:00Z"),
    location: LOCATION,
    chabadZmanim: cache,
    days: WEEK_DAYS,
  });
  check(quiet.status === "ok" && quiet.entries.length === 1,
    "the week of 9/21 has ONE — 9/25; 9/26 is a shabbos_ends carrying LightCandlesAfter, not a candle lighting",
    quiet.status === "ok" ? String(quiet.entries.length) : quiet.status);
  check(
    busy.status === "ok" && quiet.status === "ok" && busy.entries.length !== quiet.entries.length,
    "two entries one week, one the next — measured, not assumed",
    busy.status === "ok" && quiet.status === "ok" ? `${busy.entries.length} vs ${quiet.entries.length}` : "n/a",
  );
}

// "Next only" is the first entry of the same list, not a different
// computation — so it cannot drift from the multi-entry path.
{
  const week = resolveCandleLightings({
    now: new Date("2026-09-17T12:00:00Z"),
    location: LOCATION,
    chabadZmanim: cache,
    days: WEEK_DAYS,
  });
  const single = resolveCandleLighting({
    now: new Date("2026-09-17T12:00:00Z"),
    location: LOCATION,
    chabadZmanim: cache,
  });
  check(
    week.status === "ok" && single !== null && iso(week.entries[0].time) === iso(single.time),
    "the week's first entry is exactly what the single-value resolver returns",
    week.status === "ok" && single ? `${iso(week.entries[0].time)} == ${iso(single.time)}` : "n/a",
  );
}

console.log("\n-- the window is a horizon, not a filter -------------------");

{
  // `days` bounds how far ahead the calendar looks, and it has to be wide
  // enough to find the next entry at all — which is why "next only" asks
  // for the week and takes the first, rather than asking for one day.
  const oneDay = upcomingCandleLightings(new Date("2026-09-14T12:00:00Z"), LOCATION, 1);
  const week = upcomingCandleLightings(new Date("2026-09-14T12:00:00Z"), LOCATION, WEEK_DAYS);
  check(oneDay.length === 0 && week.length > 0,
    "a one-day horizon on a Monday finds nothing while a week finds Friday",
    `${oneDay.length} vs ${week.length}`);
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
