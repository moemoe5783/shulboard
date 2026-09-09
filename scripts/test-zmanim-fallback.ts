/**
 * lib/zmanim/resolve.ts's fallback chain — plan.md §5c's "requested
 * provider → cache → Hebcal (client-side, always works)" for
 * `candle_lighting`.
 *
 * No network, no DOM, no React: `resolveCandleLighting` is a pure function
 * of (now, provider, location, cache dict), which is the whole reason the
 * decision lives there rather than inside the Renderer's JSX.
 *
 * THE CACHE VALUES BELOW ARE THE REAL FIXTURE'S. They are read straight out
 * of test/fixtures/chabad-zmanim-33710-sep2026.json — a hand-fetched
 * chabad.org response for ZIP 33710 (Saint Petersburg, FL) covering Thu
 * 9/10/2026 through Sun 9/13/2026 — through the real adapter, not
 * hand-typed here. So the one cached candle lighting these tests see (9/11,
 * 7:22 PM) and the three days that carry none (9/10, 9/12, 9/13) are the
 * endpoint's own answers, including the second-night Yom Tov case on 9/12
 * that this fallback exists for.
 *
 * Run with: npm run test:zmanim-fallback — not plain `node`. Loading the
 * fixture through the adapter means importing a module that imports
 * `server-only`, which throws unless the `react-server` export condition is
 * set (see the npm script; same reason scripts/test-chabad-adapter.ts needs
 * it).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BoardLocation } from "../lib/board-location.tsx";
import { upcomingCandleLighting } from "../lib/hebrew/candle-times.ts";
import { fetchChabadZmanim } from "../lib/zmanim/chabad-adapter.ts";
import { resolveCandleLighting, type ChabadZmanimByDate } from "../lib/zmanim/resolve.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

// Saint Petersburg, FL — the fixture's own location, so the Hebcal times
// computed here are directly comparable to the cached Chabad ones.
const LOCATION: BoardLocation = {
  latitude: 27.7898,
  longitude: -82.7243,
  timeZone: "America/New_York",
};

// ---- load the real fixture through the real adapter ----------------------

const FIXTURE_PATH = fileURLToPath(new URL("../test/fixtures/chabad-zmanim-33710-sep2026.json", import.meta.url));
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => ({
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => FIXTURE,
})) as unknown as typeof fetch;
const { times: CACHE } = await fetchChabadZmanim({
  locationId: "33710",
  locationType: "2",
  startDate: "2026-09-10",
  endDate: "2026-09-13",
  timeZone: "America/New_York",
});
globalThis.fetch = originalFetch;

check(
  CACHE["2026-09-11"]?.candle_lighting?.iso === "2026-09-11T23:22:00.000Z",
  "fixture loaded through the real adapter: 9/11 carries the real 7:22 PM value",
  CACHE["2026-09-11"]?.candle_lighting?.iso,
);
check(
  CACHE["2026-09-12"] === undefined,
  "fixture loaded through the real adapter: 9/12 (second night Rosh Hashanah) carries none",
);

const iso = (d: Date) => d.toISOString();

// ---- 1. the happy path: Chabad has the needed date ----------------------
//
// 9/11 16:00Z is the afternoon of Erev Rosh Hashanah. The date about to
// happen is 9/11, and the cache has it, so the cached value is used and
// nothing has fallen back.

const happy = resolveCandleLighting({
  now: new Date("2026-09-11T16:00:00Z"),
  provider: "chabad",
  location: LOCATION,
  chabadZmanim: CACHE,
});
check(happy?.fellBackToHebcal === false, "chabad + real cached value for the needed date: no fallback");
check(happy?.event === null, "chabad + cached value: no hebcal event, so the widget uses the generic label");
check(
  happy !== null && iso(happy.time) === "2026-09-11T23:22:00.000Z",
  "chabad + cached value: the value shown is CHABAD'S, not a recomputation",
  happy && iso(happy.time),
);

// ---- 2. by DATE, not by instant ----------------------------------------
//
// The single most important property, and the one an "is the value equal to
// Hebcal's" check would get wrong. Providers legitimately differ by a
// minute or two on the same date — plan.md §5c's whole reason for
// supporting more than one — so a good Chabad value that disagrees with
// Hebcal must still win. Hebcal's own answer for this instant is
// 23:22:00Z, identical to the fixture's, so the fixture alone cannot prove
// this; a deliberately-offset copy of the cache can.

const hebcalHappy = upcomingCandleLighting(new Date("2026-09-11T16:00:00Z"), LOCATION);
check(
  hebcalHappy !== null && iso(hebcalHappy.eventTime) === "2026-09-11T23:22:00.000Z",
  "hebcal agrees with chabad to the minute on 9/11, so an equality check could not distinguish them",
  hebcalHappy && iso(hebcalHappy.eventTime),
);

const offsetCache: ChabadZmanimByDate = {
  "2026-09-11": { candle_lighting: { iso: "2026-09-11T23:25:00.000Z", display: "7:25 PM" } },
};
const offset = resolveCandleLighting({
  now: new Date("2026-09-11T16:00:00Z"),
  provider: "chabad",
  location: LOCATION,
  chabadZmanim: offsetCache,
});
check(
  offset?.fellBackToHebcal === false && iso(offset.time) === "2026-09-11T23:25:00.000Z",
  "a chabad value 3 minutes off hebcal's on the same date is KEPT, not discarded as a miss",
  offset && `${iso(offset.time)} fellBack=${offset.fellBackToHebcal}`,
);

// ---- 3. the second Yom Tov night: a real no-match ----------------------
//
// 9/12 16:00Z. Hebcal's next candle lighting is 9/13 00:14Z — 8:14 PM local
// on 9/12, the second night of Rosh Hashanah, lit after nightfall. The
// fixture HAS that time, as `ZmanType: "ShabbatEndTime"` /
// `Title: "Candle Lighting after"`, and the adapter deliberately excludes
// it, so the cache has no `candle_lighting` for 9/12. Note the cache is not
// empty here — it holds 9/11 — which is exactly why the trigger has to be
// "is the needed date present" rather than "is the dict empty."

const secondNight = resolveCandleLighting({
  now: new Date("2026-09-12T16:00:00Z"),
  provider: "chabad",
  location: LOCATION,
  chabadZmanim: CACHE,
});
check(secondNight?.fellBackToHebcal === true, "chabad + second Yom Tov night (real no-match): falls back to hebcal");
check(
  secondNight !== null && iso(secondNight.time) === "2026-09-13T00:14:00.000Z",
  "the fallback value is hebcal's own 8:14 PM local computation",
  secondNight && iso(secondNight.time),
);
check(secondNight?.event !== null, "the fallback carries hebcal's event, so the label is the real one");
check(
  Object.keys(CACHE).length > 0,
  "and the cache it fell back from was NOT empty — the trigger is the needed date, not an empty dict",
  `${Object.keys(CACHE).length} dates cached`,
);

// ---- 4. cache miss / cron failure: same path, same flag ----------------
//
// The user's other two named cases. Both are the cache not having the date;
// they differ only in why, which this function has no way to see and no
// reason to.

for (const [label, dict] of [
  ["a cache never warmed at all (null — a cron that has never run)", null],
  ["a cache warmed but holding nothing (a cron that ran and got nowhere)", {}],
  ["a cache holding only unrelated dates (a stale window)", { "2026-01-02": {} }],
] as [string, ChabadZmanimByDate | null][]) {
  const miss = resolveCandleLighting({
    now: new Date("2026-09-11T16:00:00Z"),
    provider: "chabad",
    location: LOCATION,
    chabadZmanim: dict,
  });
  check(
    miss?.fellBackToHebcal === true && iso(miss.time) === "2026-09-11T23:22:00.000Z",
    `chabad + ${label}: falls back to hebcal's value`,
    miss && `${iso(miss.time)} fellBack=${miss.fellBackToHebcal}`,
  );
}

// ---- 5. ISOLATION PROOF: hebcal and manual are untouched ---------------
//
// The property the request asks to be provable, not asserted: a
// Hebcal- or Manual-configured widget resolves to byte-identical output
// before and after this change, and never flags. "Before" is
// `upcomingCandleLighting` called directly — the exact call the Renderer
// made prior to this change, and still the only computation either path
// runs.

const PROBE_INSTANTS = [
  "2026-09-09T12:00:00Z", // an ordinary Wednesday
  "2026-09-11T16:00:00Z", // Erev Rosh Hashanah afternoon
  "2026-09-11T23:30:00Z", // eight minutes AFTER candle lighting: must advance
  "2026-09-12T16:00:00Z", // second night Yom Tov — chabad's fallback case
  "2026-09-13T16:00:00Z", // motzei Yom Tov, next event a plain Friday
  "2026-03-08T12:00:00Z", // the US DST spring-forward weekend
];

for (const instant of PROBE_INSTANTS) {
  const now = new Date(instant);

  // hebcal: same value, no flag, and the same label. Compared by
  // `renderBrief` in both scripts rather than by object identity — that
  // method is the entire surface the widget's label reads
  // (lib/hebrew/format.ts's `formatEventLabel` takes nothing else), and two
  // separate calls to `upcomingCandleLighting` legitimately build two
  // distinct event objects for the same event.
  const before = upcomingCandleLighting(now, LOCATION);
  const after = resolveCandleLighting({ now, provider: "hebcal", location: LOCATION, chabadZmanim: null });
  const sameLabel =
    before !== null &&
    after?.event != null &&
    after.event.renderBrief("en") === before.renderBrief("en") &&
    after.event.renderBrief("he") === before.renderBrief("he");
  check(
    before !== null && after !== null && iso(after.time) === iso(before.eventTime) && sameLabel,
    `hebcal at ${instant}: identical value and identical label to the pre-change call`,
    after && `${iso(after.time)} ${after.event?.renderBrief("en")}`,
  );
  check(after?.fellBackToHebcal === false, `hebcal at ${instant}: no indicator`);

  // A hebcal widget is unaffected even when a chabad cache happens to be
  // sitting in context — an org that switched providers, an editor preview
  // that read the cache. The provider decides, nothing else.
  const withCache = resolveCandleLighting({ now, provider: "hebcal", location: LOCATION, chabadZmanim: CACHE });
  check(
    withCache !== null && before !== null && iso(withCache.time) === iso(before.eventTime),
    `hebcal at ${instant}: a populated chabad cache in context changes nothing`,
  );
  check(withCache?.fellBackToHebcal === false, `hebcal at ${instant}: still no indicator with a cache present`);

  // manual: the minutes-before-sunset parameter still reaches hebcal, and
  // still never flags.
  const manualBefore = upcomingCandleLighting(now, LOCATION, 40);
  const manualAfter = resolveCandleLighting({
    now,
    provider: "manual",
    location: LOCATION,
    chabadZmanim: CACHE,
    manualMinutesBeforeSunset: 40,
  });
  check(
    manualBefore !== null && manualAfter !== null && iso(manualAfter.time) === iso(manualBefore.eventTime),
    `manual(40) at ${instant}: identical value to the pre-change call`,
    manualAfter && iso(manualAfter.time),
  );
  check(manualAfter?.fellBackToHebcal === false, `manual(40) at ${instant}: no indicator`);
}

// That the manual parameter is actually load-bearing, checked once at an
// instant whose next candle lighting is an ordinary sunset-minus-N Friday
// one. Deliberately not asserted inside the loop above: at two of those
// instants the next lighting is the second night of a two-day Yom Tov,
// derived from nightfall rather than from sunset minus a configurable
// offset, so `candleLightingMins` correctly makes no difference there and
// asserting otherwise would be asserting a bug.
const ordinaryFriday = new Date("2026-09-09T12:00:00Z");
check(
  iso(upcomingCandleLighting(ordinaryFriday, LOCATION)!.eventTime) !==
    iso(upcomingCandleLighting(ordinaryFriday, LOCATION, 40)!.eventTime),
  "manual(40) really is a different time from the 18-minute default on an ordinary Friday",
  `${iso(upcomingCandleLighting(ordinaryFriday, LOCATION)!.eventTime)} vs ${iso(upcomingCandleLighting(ordinaryFriday, LOCATION, 40)!.eventTime)}`,
);

// A chabad widget's manualMinutesBeforeSunset is ignored, as the manifest
// says — it must not silently change the fallback's own computation.
const chabadIgnoresManual = resolveCandleLighting({
  now: new Date("2026-09-12T16:00:00Z"),
  provider: "chabad",
  location: LOCATION,
  chabadZmanim: CACHE,
  manualMinutesBeforeSunset: 40,
});
check(
  chabadIgnoresManual !== null && iso(chabadIgnoresManual.time) === "2026-09-13T00:14:00.000Z",
  "chabad's fallback ignores manualMinutesBeforeSunset, same as the manifest says the field is ignored",
  chabadIgnoresManual && iso(chabadIgnoresManual.time),
);

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
