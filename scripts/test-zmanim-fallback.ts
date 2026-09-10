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
 * of test/fixtures/chabad-zmanim-33701-92day.json — a real 92-day
 * Get_Zmanim response for ZIP 33701 (Saint Petersburg, FL) — through the
 * real reader, not hand-typed here. That is deliberately the SAME source
 * that fills `zmanim_cache` in production (lib/zmanim/warm.ts), so this
 * suite exercises the fallback against the values a screen would really
 * have. It used to load the published embed's 4-week capture instead; that
 * surface is no longer what production reads.
 *
 * The fixture's 9/11 candle lighting (7:22 PM) and its 9/12 entry — the
 * second night of Rosh Hashanah, which Chabad files as a `ShabbatEndTime`
 * with a `LightCandlesAfter` footnote so it never lands under
 * `candle_lighting` — are the two cases this fallback exists for. That
 * pair reads differently through this reader than through the embed and it
 * matters: the 9/12 DATE is now present in the cache dict, carrying twelve
 * other zmanim, with only `candle_lighting` missing from it. A resolver
 * that asked "is this date cached" rather than "is this VALUE cached"
 * would now answer wrongly, so the case is asserted below rather than
 * assumed.
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
import {
  WEEK_DAYS,
  resolveCandleLighting,
  resolveCandleLightings,
  type ChabadZmanimByDate,
} from "../lib/zmanim/resolve.ts";
import { isClockZman } from "../lib/zmanim/zman.ts";

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

/** The cached value for one date and id, only if it is a clock time —
 *  `zmanim_cache.times` also holds a duration (`chabad:ShaahZmanit`), and
 *  nothing here may read one as an instant. */
const cached = (date: string, id = "candle_lighting") => {
  const value = CACHE[date]?.[id];
  return value && isClockZman(value) ? value : undefined;
};

check(
  cached("2026-09-11")?.iso === "2026-09-11T23:22:00.000Z",
  "fixture loaded through the real reader: 9/11 carries the real 7:22 PM value",
  cached("2026-09-11")?.iso,
);
check(
  CACHE["2026-09-12"] !== undefined && !("candle_lighting" in CACHE["2026-09-12"]),
  "9/12 (second night Rosh Hashanah) IS in the cache with its other zmanim, and has no candle_lighting",
  Object.keys(CACHE["2026-09-12"] ?? {}).length + " ids, candle_lighting absent",
);
check(
  cached("2026-09-12", "shabbos_ends")?.footnote?.type === "LightCandlesAfter",
  "and what it has instead is a shabbos_ends carrying the LightCandlesAfter footnote",
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
// fixture HAS that time, as "Light Holiday Candles after&nbsp;8:14 PM",
// and the reader deliberately excludes it, so the cache has no
// `candle_lighting` for 9/12. Note the cache is not
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

// ---- 3b. past the window's end: still a real case, just a far one -----
//
// The window is 92 days (WARM_DAYS in lib/zmanim/warm.ts) and this
// fixture's last day is 12/10, so a screen asking after that is past
// everything cached and falls through to Hebcal with the indicator. That
// is the designed behaviour of §5c's fallback chain — NOT a warming
// failure and NOT what the zero-candle-lighting alarm is for.
//
// Three months out this is no longer the common path it was at four weeks,
// which is exactly why it is still asserted: the case now only shows up
// for a location whose cron has stopped, where nothing else would catch a
// regression in it.

const pastWindow = resolveCandleLighting({
  now: new Date("2026-12-20T16:00:00Z"),
  provider: "chabad",
  location: LOCATION,
  chabadZmanim: CACHE,
});
check(
  pastWindow?.fellBackToHebcal === true,
  "a date past the 92-day window falls back to hebcal — expected, not a failure",
  pastWindow && `${iso(pastWindow.time)} fellBack=${pastWindow.fellBackToHebcal}`,
);
check(
  Object.keys(CACHE).sort().at(-1) === "2026-12-10",
  "and the cache really does end at 12/10 — 92 days of coverage, nothing beyond",
  Object.keys(CACHE).sort().at(-1),
);

// The zero-candle-lighting alarm is `> 0`, not a count tuned to a span, so
// widening the window from four weeks to 92 days only strengthened it:
// thirteen Fridays plus Erev Yom Kippur on a Sunday.
const candleLightingCount = Object.values(CACHE).filter((day) => day.candle_lighting).length;
check(
  candleLightingCount === 14,
  "a healthy 92-day response carries fourteen candle lightings, so the zero alarm stays meaningful",
  String(candleLightingCount),
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


// ---- 5. the fallback is a CHOICE (fallbackToCalculated) ----------------
//
// Some shuls would rather show nothing than a time that isn't from the
// source they picked. With the switch off, a date Chabad has no value for
// is dropped rather than computed — and a resolution with nothing left is
// "unavailable", a distinct status the widget renders its own state for.

const chabad = (now: string, fallbackToCalculated: boolean, dict = CACHE) =>
  resolveCandleLightings({
    now: new Date(now),
    provider: "chabad",
    location: LOCATION,
    chabadZmanim: dict,
    days: WEEK_DAYS,
    fallbackToCalculated,
  });

{
  // 9/12: the second night of Rosh Hashanah, which Chabad files as a
  // ShabbatEndTime with a LightCandlesAfter footnote. With fallback
  // ON this is Hebcal's 8:14 PM; with it OFF there is nothing to show for
  // that date — but 9/18 is inside the week and IS cached, so the week
  // still has an entry.
  const on = chabad("2026-09-12T16:00:00Z", true);
  const off = chabad("2026-09-12T16:00:00Z", false);
  check(on.status === "ok" && on.entries[0].fellBackToHebcal === true,
    "fallback ON: the second Yom Tov night is computed and flagged",
    on.status === "ok" ? String(on.entries[0].fellBackToHebcal) : on.status);
  check(
    off.status === "ok" && off.entries.every((e) => !e.fellBackToHebcal),
    "fallback OFF: no entry in the week is a computed one",
    off.status === "ok" ? off.entries.map((e) => e.fellBackToHebcal).join(",") : off.status,
  );
  check(
    off.status === "ok" && iso(off.entries[0].time) === "2026-09-18T23:14:00.000Z",
    "fallback OFF: the next entry shown is Chabad's own 9/18, not a computed 9/12",
    off.status === "ok" ? iso(off.entries[0].time) : off.status,
  );
}

{
  // Past the 92-day window: nothing cached anywhere in the week, so with
  // fallback off there is genuinely nothing — the "unavailable" state,
  // which is NOT an offline condition.
  const off = chabad("2026-12-20T16:00:00Z", false);
  const on = chabad("2026-12-20T16:00:00Z", true);
  check(off.status === "unavailable", "fallback OFF past the window: unavailable", off.status);
  check(on.status === "ok" && on.entries[0].fellBackToHebcal === true,
    "fallback ON past the window: computed and flagged, same instant",
    on.status === "ok" ? iso(on.entries[0].time) : on.status);
}

{
  // An empty cache with fallback off is the same answer — the widget never
  // silently shows a computed time it was told not to compute.
  const off = chabad("2026-09-11T16:00:00Z", false, {});
  check(off.status === "unavailable", "fallback OFF with a cache that has nothing: unavailable", off.status);
}

// Hebcal and Manual ARE the computed path, so the switch has nothing to say
// about them. Turning it off must not blank a Hebcal widget — this is the
// isolation half of item 2.
for (const provider of ["hebcal", "manual"] as const) {
  const off = resolveCandleLightings({
    now: new Date("2026-09-11T16:00:00Z"),
    provider,
    location: LOCATION,
    chabadZmanim: CACHE,
    days: WEEK_DAYS,
    fallbackToCalculated: false,
    manualMinutesBeforeSunset: 18,
  });
  check(
    off.status === "ok" && off.entries.length > 0 && !off.entries[0].fellBackToHebcal,
    `${provider} with fallback OFF still resolves — the switch is Chabad-only`,
    off.status === "ok" ? iso(off.entries[0].time) : off.status,
  );
}

// ---- 6. multiple candle lightings in one week -------------------------
//
// The real fixture's own week of 9/18: Friday 9/18 and Erev Yom Kippur on
// Sunday 9/20, both cached. This is the case the "all upcoming" display
// mode exists for, and the single-value resolver cannot express it.

{
  const week = chabad("2026-09-17T12:00:00Z", true);
  check(week.status === "ok" && week.entries.length === 2,
    "the week of 9/18 has TWO candle lightings — Friday 9/18 and Erev Yom Kippur Sunday 9/20",
    week.status === "ok" ? String(week.entries.length) : week.status);
  check(
    week.status === "ok" &&
      week.entries.map((e) => iso(e.time)).join(" ") === "2026-09-18T23:14:00.000Z 2026-09-20T23:11:00.000Z",
    "in order, and both are Chabad's own values",
    week.status === "ok" ? week.entries.map((e) => iso(e.time)).join(" ") : week.status,
  );
  check(
    week.status === "ok" && week.entries.every((e) => !e.fellBackToHebcal),
    "neither needed a fallback",
  );
}

{
  // And an ordinary week has one. THE COUNT VARYING is the whole reason
  // "all upcoming" is a hug-mode widget (sizing.md §2's "content whose
  // amount, not whose row design, changes at runtime") rather than a
  // fit- or fixed-mode one.
  //
  // Measured with fallback OFF, so this counts only what Chabad actually
  // published as a CandleLighting: the week of 9/21 has one such date,
  // 9/25 — 9/26 is a shabbos_ends carrying LightCandlesAfter, which is
  // not candle lighting. With fallback ON
  // it would be two, because Hebcal also produces the second night of
  // Sukkot on 9/26 — which is itself a nice illustration that the count
  // moves for two independent reasons.
  const quiet = chabad("2026-09-21T12:00:00Z", false);
  const busy = chabad("2026-09-17T12:00:00Z", false);
  check(
    quiet.status === "ok" && quiet.entries.length === 1,
    "the week of 9/21 has ONE — so the count varies week to week, which is why `all` forces hug",
    quiet.status === "ok" ? String(quiet.entries.length) : quiet.status,
  );
  check(
    busy.status === "ok" && quiet.status === "ok" && busy.entries.length !== quiet.entries.length,
    "two entries one week, one the next — measured, not assumed",
    busy.status === "ok" && quiet.status === "ok" ? `${busy.entries.length} vs ${quiet.entries.length}` : "n/a",
  );
}

// "Next only" is the first entry of the same list, not a different
// computation — so it cannot drift from the multi-entry path.
{
  const week = chabad("2026-09-17T12:00:00Z", true);
  const single = resolveCandleLighting({
    now: new Date("2026-09-17T12:00:00Z"),
    provider: "chabad",
    location: LOCATION,
    chabadZmanim: CACHE,
  });
  check(
    week.status === "ok" && single !== null && iso(week.entries[0].time) === iso(single.time),
    "the week's first entry is exactly what the single-value resolver returns",
    week.status === "ok" && single ? `${iso(week.entries[0].time)} == ${iso(single.time)}` : "n/a",
  );
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
