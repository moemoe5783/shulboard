/**
 * Non-US zmanim: the timezone arithmetic, the location search's response
 * shapes, and how a searched city id resolves.
 *
 * WHY A SEPARATE SUITE. Every other zmanim test runs in
 * America/New_York, because that is the zone the one real captured
 * response belongs to. Nothing was wrong with that while `locationtype=1`
 * was unreachable and a non-US shul could not be configured at all. Now
 * that `Get_Locations` makes one configurable, the conversion this project
 * does — Chabad's wall-clock strings plus the org's IANA zone, into
 * instants — has to be shown to work in a zone with a different DST
 * schedule, and Europe/Zurich has one: it shifts at 01:00 UTC on the last
 * Sunday of March and October, where the US shifts at 06:00/07:00 UTC on
 * different Sundays entirely.
 *
 * THE ZURICH DAYS BELOW ARE SYNTHETIC AND SAY SO. There is no captured
 * Get_Zmanim response for a European city — the endpoint has been read for
 * one US ZIP and nothing else — so these carry the response's real SHAPE
 * with hand-chosen clock strings placed exactly where the arithmetic is
 * interesting. That is the right kind of fixture for this: what is under
 * test is this project's own wall-clock-to-instant conversion, not
 * chabad.org's astronomy, and a real capture would prove nothing extra
 * about the conversion while making the interesting minutes accidental.
 *
 * Run with: npm run test:zmanim-international — not plain `node`. The
 * modules under test import `server-only`.
 */

import { fetchChabadZmanim } from "../lib/zmanim/chabad-adapter.ts";
import { searchChabadLocations } from "../lib/zmanim/chabad-locations.ts";
import { resolveChabadLocation } from "../lib/zmanim/location.ts";
import { resolveZmanimForDate } from "../lib/zmanim/resolve-zmanim.ts";
import { zonedTimeToUtc } from "../lib/zmanim/time.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function expectThrow(label: string, run: () => Promise<unknown>, mustInclude: string) {
  try {
    await run();
    check(false, label, "did not throw");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    check(message.includes(mustInclude), label, message);
  }
}

const ZURICH = "Europe/Zurich";
const wall = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);

console.log("\n-- the two-pass offset fix holds in a non-US zone ----------");

/*
 * THE SAME BUG, IN A DIFFERENT WINDOW, AND TWICE. New York's one-pass
 * failure was local times between 02:00 and 06:00 on the autumn fall-back
 * day; Zurich shifts at 01:00 UTC, so its broken window is 01:00 to 03:00
 * local, and BOTH of its transitions have one rather than just the
 * autumn one. That is why running every zmanim test in one zone was not
 * enough: the window is a function of the zone's own shift time, and
 * nothing about New York's window predicts Zurich's.
 *
 * These assert the CORRECT instant. Each one is a case a single
 * offset-by-round-trip pass got wrong by an hour — verified by running
 * both implementations side by side — so they are regression assertions
 * for lib/zmanim/time.ts and not merely coverage.
 */
{
  // Spring forward, 29 March 2026: 02:00 -> 03:00 local, at 01:00 UTC.
  // 01:30 local is a real, unambiguous CET time. One pass read the offset
  // at the guess (01:30 UTC, already CEST) and landed on 23:30 UTC the day
  // before, which displays as 00:30 — an hour early.
  const springEarly = zonedTimeToUtc(2026, 3, 29, 1, 30, ZURICH);
  check(springEarly.toISOString() === "2026-03-29T00:30:00.000Z",
    "01:30 on the spring-forward day is 00:30 UTC (CET, +1), not 23:30 the day before",
    springEarly.toISOString());
  check(wall(springEarly, ZURICH) === "01:30", "and it displays back as the 01:30 it was asked for",
    wall(springEarly, ZURICH));

  // A local time on either side of the shift, to show nothing else moved.
  const springBefore = zonedTimeToUtc(2026, 3, 29, 0, 30, ZURICH);
  const springAfter = zonedTimeToUtc(2026, 3, 29, 5, 0, ZURICH);
  check(springBefore.toISOString() === "2026-03-28T23:30:00.000Z" &&
    springAfter.toISOString() === "2026-03-29T03:00:00.000Z",
    "00:30 (CET) and 05:00 (CEST) on the same day resolve at their own offsets",
    `${springBefore.toISOString()} / ${springAfter.toISOString()}`);
}

{
  // Fall back, 25 October 2026: 03:00 -> 02:00 local, at 01:00 UTC. Note
  // the REPEATED hour here is 02:00-02:59, not 01:00-01:59 as it is in the
  // US — so 01:30 is unambiguous, and one pass still got it wrong: it
  // resolved to an instant that displays as 02:30.
  const fallEarly = zonedTimeToUtc(2026, 10, 25, 1, 30, ZURICH);
  check(fallEarly.toISOString() === "2026-10-24T23:30:00.000Z",
    "01:30 on the fall-back day is 23:30 UTC (CEST, +2) — an unambiguous time one pass still missed",
    fallEarly.toISOString());
  check(wall(fallEarly, ZURICH) === "01:30", "and it displays back as 01:30", wall(fallEarly, ZURICH));

  // The genuinely ambiguous hour. 02:30 occurs twice; both passes agree,
  // and the answer is the FIRST occurrence (CEST) — the same choice New
  // York's 01:14 makes, and the right one for a solar midpoint.
  const ambiguous = zonedTimeToUtc(2026, 10, 25, 2, 30, ZURICH);
  check(ambiguous.toISOString() === "2026-10-25T01:30:00.000Z",
    "02:30, which happens twice, resolves to the second occurrence (CET)",
    `${ambiguous.toISOString()} = ${wall(ambiguous, ZURICH)}`);
}

console.log("\n-- a Zurich board's chatzos halayla still rolls over -------");

/*
 * SYNTHETIC DAYS — see this file's header. Real response shape, hand-chosen
 * clock strings, placed so that the ChatzosNight rollover lands inside each
 * of Zurich's two broken windows. That combination is reachable in
 * practice rather than contrived: solar midnight in CET falls after 01:00
 * local at western longitudes in the zone, so a shul in the west of the
 * Central European band genuinely has a chatzos halayla in the 01:00-03:00
 * range, on exactly the dates below.
 */
const ZURICH_DAYS = [
  { date: "3/28/2026", netz: "6:44 AM", shkia: "7:38 PM", chatzosNight: "1:34 AM" },
  { date: "3/29/2026", netz: "7:42 AM", shkia: "8:40 PM", chatzosNight: "2:34 AM" },
  { date: "10/24/2026", netz: "8:00 AM", shkia: "6:36 PM", chatzosNight: "1:30 AM" },
  { date: "10/25/2026", netz: "7:01 AM", shkia: "5:34 PM", chatzosNight: "12:30 AM" },
];

const ZURICH_BODY = {
  LocationName: "Lugano, Switzerland",
  LocationDetails: "Candle Lighting is 18 mins. before sunset&nbsp; | &nbsp;+1 GMT",
  EndDate: "10/25/2026",
  LocationId: null,
  Footnotes: {},
  GroupHeadings: [
    { EssentialZmanType: "NetzHachamah", Order: 2, EssentialTitle: "Sunrise" },
    { EssentialZmanType: "Shkiah", Order: 12, EssentialTitle: "Sunset" },
    { EssentialZmanType: "ChatzosNight", Order: 19, EssentialTitle: "Midnight" },
  ],
  Days: ZURICH_DAYS.map((day) => ({
    DisplayDate: day.date,
    HolidayName: null,
    IsHoliday: false,
    Zmanim: [
      { EssentialZmanType: "NetzHachamah", Zman: day.netz, FootnoteType: "None" },
      { EssentialZmanType: "Shkiah", Zman: day.shkia, FootnoteType: "None" },
      { EssentialZmanType: "ChatzosNight", Zman: day.chatzosNight, FootnoteType: "None" },
    ],
  })),
};

function stubFetch(body: unknown, options: { status?: number; text?: string } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: (options.status ?? 200) < 400,
    status: options.status ?? 200,
    statusText: "OK",
    text: async () => options.text ?? JSON.stringify(body),
  })) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const restoreZurich = stubFetch(ZURICH_BODY);
const zurich = await fetchChabadZmanim({
  locationId: "872",
  locationType: "1",
  expectedName: "Lugano, Switzerland",
  startDate: "2026-03-28",
  endDate: "2026-10-25",
  timeZone: ZURICH,
});
restoreZurich();

const clockOf = (date: string, id: string) => {
  const value = zurich.times[date]?.[id];
  return value && "iso" in value ? value : undefined;
};

/**
 * An instant's calendar date IN A ZONE, as `YYYY-MM-DD`.
 *
 * NOT `iso.slice(0, 10)`, AND THIS SUITE IS WHY. The rollover rule is
 * about LOCAL calendar days — chatzos halayla belongs to the night after
 * its row — and slicing the ISO string compares UTC days instead. Those
 * agree for the Americas, where a small-hours local instant has a UTC date
 * one day ahead, which is how the New York assertions got away with it.
 * East of Greenwich they disagree in the other direction: 01:30 on 25
 * October in Zurich is 23:30 UTC on the 24th, so a UTC slice reads the
 * rolled-over instant as being on its own row's date and the assertion
 * fails on a value that is completely correct.
 */
function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

check(Object.keys(zurich.times).length === 4, "all four synthetic Zurich days parsed",
  String(Object.keys(zurich.times).length));
check(zurich.location === "Lugano, Switzerland",
  "and the response verified against the searched Title rather than a ZIP", zurich.location);

// The rollover itself: the instant is on the day AFTER the row, in a zone
// that is not America/New_York.
for (const [row, expectedIso, note] of [
  ["2026-03-28", "2026-03-29T00:34:00.000Z", "1:34 AM rolls into the spring-forward day and stays CET (+1)"],
  ["2026-03-29", "2026-03-30T00:34:00.000Z", "2:34 AM the next night is CEST (+2), an hour's less offset apart"],
  ["2026-10-24", "2026-10-24T23:30:00.000Z", "1:30 AM rolls into the fall-back day and stays CEST (+2)"],
  ["2026-10-25", "2026-10-25T23:30:00.000Z", "12:30 AM the next night is CET (+1)"],
] as const) {
  const value = clockOf(row, "chatzos_laila");
  check(value?.iso === expectedIso, `${row}: ${note}`, value?.iso);
}

check(
  Object.keys(zurich.times).every(
    (date) => localDate(new Date(clockOf(date, "chatzos_laila")!.iso), ZURICH) !== date,
  ),
  "every one of them falls on a different LOCAL calendar day from its own cache row",
);
// The UTC-slice version of that same assertion, which is what the New York
// suite uses, is shown failing here on purpose: it is the reason
// `localDate` exists, and a future session tempted to simplify one into
// the other should see why they are not the same test.
check(
  Object.keys(zurich.times).some((date) => clockOf(date, "chatzos_laila")!.iso.slice(0, 10) === date),
  "while a UTC-date comparison would wrongly call at least one of them same-day — east of Greenwich",
  Object.keys(zurich.times)
    .filter((date) => clockOf(date, "chatzos_laila")!.iso.slice(0, 10) === date)
    .join(","),
);
check(
  Object.keys(zurich.times).every(
    (date) => localDate(new Date(clockOf(date, "netz")!.iso), ZURICH) === date,
  ),
  "and sunrise does not roll — the rule is per-type, not per-clock, in any zone",
);

// Ordering: chatzos halayla still sorts last, which is the property the
// next-day instant exists to produce.
{
  const rows = resolveZmanimForDate({
    date: "2026-03-28",
    ids: ["netz", "shkia", "chatzos_laila"],
    chabadZmanim: zurich.times,
  });
  check(rows.map((row) => row.id).join(",") === "netz,shkia,chatzos_laila",
    "a Zurich table orders by instant and puts 1:34 AM last, not first",
    rows.map((row) => `${row.id} ${row.display}`).join(" | "));
}

// And the offset really is what a European zone would give, not a US one —
// the check that this suite is testing something the others could not.
check(
  clockOf("2026-03-28", "shkia")!.iso === "2026-03-28T18:38:00.000Z",
  "7:38 PM in Zurich is 18:38 UTC (+1), where the same string in New York would be 23:38",
  clockOf("2026-03-28", "shkia")!.iso,
);

console.log("\n-- Get_Locations: every shape nobody has observed -----------");

/*
 * The endpoint has been read ONCE, for one query, returning one
 * suggestion. Its multi-result behaviour is unobserved: this project's
 * sandbox cannot reach chabad.org (the egress proxy refuses CONNECT) and
 * the person who can was served a cached response.
 *
 * So the reader is written to assume none of it, and this is where that is
 * proved. Every case below is a shape the endpoint MIGHT return, driven
 * through the real reader with a stubbed body — which is the only honest
 * way to test a contract nobody has established.
 * scripts/probe-chabad-locations.ts is what settles the real behaviour.
 */

{
  // The one hand-verified response, doubled space and all.
  const restore = stubFetch({ Suggestions: [{ Title: "Lugano,  Switzerland", Value: "872", ItemType: "1" }] });
  const outcome = await searchChabadLocations("Lugano");
  restore();
  check(outcome.ok && outcome.suggestions.length === 1, "the hand-verified single-result response reads");
  check(outcome.ok && outcome.suggestions[0].title === "Lugano, Switzerland",
    "the doubled space is normalized for display",
    outcome.ok ? JSON.stringify(outcome.suggestions[0].title) : "");
  check(outcome.ok && outcome.suggestions[0].rawTitle === "Lugano,  Switzerland",
    "and the raw title is kept alongside it");
  check(outcome.ok && outcome.suggestions[0].value === "872",
    "the Value is untouched — it is an opaque id, not a display string");
  check(outcome.ok && outcome.suggestions[0].type === "1", "and the type comes from ItemType, never a default");
}

{
  // MULTIPLE MATCHES — the case item 2 turns on. A US result carrying
  // ItemType "2" means `Value` is a ZIP, and anything assuming "1" for
  // something found by name would query a city id that happens to share
  // those digits.
  const restore = stubFetch({
    Suggestions: [
      { Title: "Springfield,  MA 01101", Value: "01101", ItemType: "2" },
      { Title: "Springfield, IL", Value: "1234", ItemType: "1" },
      { Title: "Springfield,  United Kingdom", Value: "5678", ItemType: "1" },
    ],
  });
  const outcome = await searchChabadLocations("Springfield");
  restore();
  check(outcome.ok && outcome.suggestions.length === 3, "three suggestions all read",
    outcome.ok ? String(outcome.suggestions.length) : "");
  check(outcome.ok && outcome.suggestions.map((s) => s.type).join(",") === "2,1,1",
    "each keeps its OWN ItemType — a mixed list is exactly what must not be flattened",
    outcome.ok ? outcome.suggestions.map((s) => `${s.value}:${s.type}`).join(" ") : "");
  check(
    outcome.ok && resolveChabadLocation({
      orgZmanimLocationId: outcome.suggestions[0].value,
      orgZmanimLocationType: outcome.suggestions[0].type,
      orgZmanimLocationName: outcome.suggestions[0].title,
    })?.cacheKey === "zip:01101",
    "and an ItemType 2 result caches under zip:, sharing rows with a shul that typed that ZIP",
  );
}

{
  // Enough results to be cut. A pick-list nobody can scan is not a
  // pick-list, and the UI has to be able to say the list is incomplete
  // rather than implying it is all of them.
  const many = Array.from({ length: 25 }, (_, index) => ({
    Title: `Place ${index}, Somewhere`,
    Value: String(1000 + index),
    ItemType: "1",
  }));
  const restore = stubFetch({ Suggestions: many });
  const outcome = await searchChabadLocations("Place");
  restore();
  check(outcome.ok && outcome.suggestions.length === 20, "a long list is capped at twenty",
    outcome.ok ? String(outcome.suggestions.length) : "");
  check(outcome.ok && outcome.truncated, "and reports that it was cut");
}

{
  // Entries this cannot use: no Value, no Title, and — the important one —
  // an ItemType nobody has seen. Dropped and counted, never guessed at,
  // and the readable ones still come back.
  const restore = stubFetch({
    Suggestions: [
      { Title: "Good, Place", Value: "1", ItemType: "1" },
      { Title: "No value", ItemType: "1" },
      { Value: "2", ItemType: "1" },
      { Title: "Third kind", Value: "3", ItemType: "3" },
      { Title: "Numeric type", Value: "4", ItemType: 1 },
      "not an object",
      null,
    ],
  });
  const outcome = await searchChabadLocations("mixed");
  restore();
  check(outcome.ok && outcome.suggestions.length === 1 && outcome.suggestions[0].value === "1",
    "only the readable suggestion comes back",
    outcome.ok ? outcome.suggestions.map((s) => s.value).join(",") : "");
  check(outcome.ok && outcome.dropped === 6, "and the six unusable ones are counted, not silently ignored",
    outcome.ok ? String(outcome.dropped) : "");
}

{
  // No matches. A misspelling and a place with no Chabad presence both
  // plausibly land here, and both get the same message on purpose — from
  // where the gabbai stands they are the same thing.
  const restore = stubFetch({ Suggestions: [] });
  const outcome = await searchChabadLocations("Lugana");
  restore();
  check(!outcome.ok && outcome.reason === "not-found", "an empty Suggestions array is not-found",
    outcome.ok ? "ok" : outcome.reason);
  check(!outcome.ok && outcome.message.includes("Lugana"),
    "and the message names what was searched for", outcome.ok ? "" : outcome.message);
}

{
  // A 200 with no `Suggestions` key at all is a SHAPE ERROR, not "no
  // matches" — calling it not-found would hide a changed response behind a
  // message telling the gabbai to try another city.
  for (const [body, label] of [
    [{ Results: [] }, "a differently-named array"],
    [{ Suggestions: "nope" }, "a Suggestions that is not an array"],
    [[], "a bare array"],
    [null, "a null body"],
  ] as const) {
    const restore = stubFetch(body);
    const outcome = await searchChabadLocations("Lugano");
    restore();
    check(!outcome.ok && outcome.reason === "unavailable", `${label} reads as unavailable, not not-found`,
      outcome.ok ? "ok" : outcome.reason);
  }
}

{
  // Not JSON at all — an HTML error page, which is what a lot of ASP
  // endpoints return when they are unhappy.
  const restore = stubFetch(null, { text: "<html><body>Runtime Error</body></html>" });
  const outcome = await searchChabadLocations("Lugano");
  restore();
  check(!outcome.ok && outcome.reason === "unavailable", "an HTML body reads as unavailable",
    outcome.ok ? "ok" : outcome.reason);
  check(!outcome.ok && !outcome.message.includes("<"), "and the message shown to a gabbai carries no markup",
    outcome.ok ? "" : outcome.message);
}

{
  const restore = stubFetch(null, { status: 500 });
  const outcome = await searchChabadLocations("Lugano");
  restore();
  check(!outcome.ok && outcome.reason === "unavailable" && outcome.message.includes("500"),
    "a 500 says so, so a gabbai can tell 'try again' from 'try another city'",
    outcome.ok ? "" : outcome.message);
}

check(
  !(await searchChabadLocations("   ")).ok,
  "a blank query never reaches the network",
);

console.log("\n-- resolving a searched location ---------------------------");

{
  const city = resolveChabadLocation({
    orgZmanimLocationId: "872",
    orgZmanimLocationType: "1",
    orgZmanimLocationName: "Lugano, Switzerland",
  });
  check(city?.locationType === "1" && city?.locationId === "872", "a city id resolves with its own type");
  check(city?.cacheKey === "city:872", "under a city: cache key", city?.cacheKey);
  check(city?.expectedName === "Lugano, Switzerland", "carrying the name the response will be checked against");
}

{
  // A ZIP on file wins, which is item 5's rule: US shuls need no lookup.
  const both = resolveChabadLocation({
    orgPostalCode: "33701",
    orgZmanimLocationId: "872",
    orgZmanimLocationType: "1",
    orgZmanimLocationName: "Lugano, Switzerland",
  });
  check(both?.locationType === "2" && both?.locationId === "33701",
    "a ZIP still wins over a searched city id — the settings form says so rather than letting both compete",
    `${both?.locationId}/${both?.locationType}`);
  check(both?.expectedName === null, "and a ZIP carries no expected name: it verifies against itself");
}

{
  // An id stored before the type column existed. Read as "1", which is
  // what this resolver already assumed for that column, so nothing about
  // those orgs changes.
  const legacy = resolveChabadLocation({ orgZmanimLocationId: "370" });
  check(legacy?.locationType === "1" && legacy?.cacheKey === "city:370",
    "a legacy id with no type reads as a city id, exactly as before this column existed",
    `${legacy?.locationType} ${legacy?.cacheKey}`);
  check(legacy?.expectedName === null, "and has no name, so the adapter logs rather than refusing");
}

{
  // The three fields come from ONE tier. A screen's id with an org's type
  // would be two halves of two different places, which is the silent
  // wrong-place bug the type column exists to prevent.
  const mixed = resolveChabadLocation({
    screenZmanimLocationId: "872",
    screenZmanimLocationType: "1",
    screenZmanimLocationName: "Lugano, Switzerland",
    orgZmanimLocationId: "01101",
    orgZmanimLocationType: "2",
    orgZmanimLocationName: "Springfield, MA 01101",
  });
  check(mixed?.locationId === "872" && mixed?.locationType === "1" && mixed?.expectedName === "Lugano, Switzerland",
    "the screen's id, type and name are read together — never mixed with the org's",
    JSON.stringify(mixed));
}

console.log("\n-- and the whole way through, end to end -------------------");

{
  // A searched location, resolved, fetched and verified — the path a
  // non-US shul now has and did not before.
  const location = resolveChabadLocation({
    orgZmanimLocationId: "872",
    orgZmanimLocationType: "1",
    orgZmanimLocationName: "Lugano, Switzerland",
  })!;
  const restore = stubFetch(ZURICH_BODY);
  const result = await fetchChabadZmanim({
    locationId: location.locationId,
    locationType: location.locationType,
    expectedName: location.expectedName,
    startDate: "2026-03-28",
    endDate: "2026-10-25",
    timeZone: ZURICH,
  });
  restore();
  check(result.location === "Lugano, Switzerland", "a searched city id fetches and verifies", result.location);

  // And the same id with the wrong name stored is refused, which is the
  // control: the check is doing work rather than passing everything.
  const restoreWrong = stubFetch(ZURICH_BODY);
  await expectThrow(
    "while a mismatched stored name refuses the whole response",
    () =>
      fetchChabadZmanim({
        locationId: "872",
        locationType: "1",
        expectedName: "Zurich, Switzerland",
        startDate: "2026-03-28",
        endDate: "2026-10-25",
        timeZone: ZURICH,
      }),
    'asked for "Zurich, Switzerland" (locationid 872) but the response is for "Lugano, Switzerland"',
  );
  restoreWrong();
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
