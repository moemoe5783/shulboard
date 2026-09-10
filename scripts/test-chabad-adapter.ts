/**
 * lib/zmanim/chabad-adapter.ts's parsing, against a REAL 92-day
 * chabad.org response — no network, `fetch` stubbed to return the fixture.
 *
 * ORIGIN OF THE FIXTURE: test/fixtures/chabad-zmanim-33701-92day.json is a
 * real Get_Zmanim response for ZIP 33701 (Saint Petersburg, FL) covering
 * Thu 9/10/2026 through Thu 12/10/2026 — the full span the endpoint
 * returned for the hand-verified request, including Rosh Hashanah, Yom
 * Kippur, Sukkot, the Nov 1 DST fall-back and the start of Chanukah.
 *
 * ONE CAVEAT, STATED RATHER THAN GLOSSED: the capture reached this repo by
 * being pasted into a message and transcribed here, not written to disk
 * from the original bytes, so it is real data but not provably
 * byte-identical to what chabad.org served. Everything structural about it
 * was verified independently — 92 days with no gaps, the span matching the
 * response's own EndDate, the type vocabulary, where each footnote lands,
 * and which days carry candle lighting — and several of those invariants
 * are re-asserted below so a transcription slip cannot pass silently.
 *
 * The previous 4-day fixture for ZIP 33710 is gone, not kept alongside
 * this one: it showed a `TimeGroups[].Items[]` nesting this endpoint does
 * not return under the full parameter set, so keeping it would mean
 * testing the parser against a shape production never sees.
 *
 * Run with: npm run test:chabad-adapter — not plain `node`. The module
 * under test imports `server-only`, which throws unless the `react-server`
 * export condition is set (Next's own server build sets it; a plain `node`
 * run needs `--conditions=react-server` — see the npm script).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchChabadZmanim } from "../lib/zmanim/chabad-adapter.ts";
import {
  CANONICAL_BY_ESSENTIAL_ZMAN_TYPE,
  UNMAPPED_ESSENTIAL_ZMAN_TYPES,
  isClockZman,
  type ChabadZman,
} from "../lib/zmanim/zman.ts";

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

const FIXTURE_PATH = fileURLToPath(new URL("../test/fixtures/chabad-zmanim-33701-92day.json", import.meta.url));
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

/* The adapter reads the body with `.text()` and parses it itself, so the
 * byte length is available to its diagnostic log line. The stub has to
 * match that, not `.json()`. The captured URL is asserted below — the gap
 * that let a wrong date format and four missing parameters ship unnoticed
 * was this suite never looking at the request it was stubbing. */
const captured: { url: URL | null } = { url: null };

function stubFetch(body: unknown) {
  const original = globalThis.fetch;
  captured.url = null;
  globalThis.fetch = (async (input: URL | string) => {
    captured.url = new URL(String(input));
    return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify(body) };
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// Saint Petersburg, FL is America/New_York — real, not read off the
// fixture's own `LocationDetails` text ("-5 GMT | DST in effect"), which
// is exactly the unreliable source this adapter deliberately avoids: that
// string claims a fixed -5 (standard time) offset in the same breath as
// claiming DST is active, which would actually make it -4. It has no
// per-day breakdown either way, so it could not tell a 92-day request
// spanning the Nov 1 fall-back which of its days each offset applies to
// even if it were self-consistent.
const REQUEST = {
  locationId: "33701",
  locationType: "2" as const,
  startDate: "2026-09-10",
  endDate: "2026-12-10",
  timeZone: "America/New_York",
};

const restore = stubFetch(FIXTURE);
const result = await fetchChabadZmanim(REQUEST);
restore();
const { times, rawResponseByDate } = result;

const dates = Object.keys(times).sort();
const clock = (date: string, id: string) => {
  const value: ChabadZman | undefined = times[date]?.[id];
  return value && isClockZman(value) ? value : undefined;
};

console.log("\n-- the outgoing request ------------------------------------");

check(
  captured.url?.origin + (captured.url?.pathname ?? "") ===
    "https://www.chabad.org/webservices/zmanim/zmanim/Get_Zmanim",
  "the endpoint is chabad.org's Get_Zmanim, unchanged",
  captured.url?.origin + (captured.url?.pathname ?? ""),
);
check(captured.url?.searchParams.get("locationid") === "33701", "locationid carries the ZIP");
check(captured.url?.searchParams.get("locationtype") === "2", "locationtype=2 — a ZIP, never Chabad's opaque city numbering");
check(captured.url?.searchParams.get("save") === "1", "save=1");
check(
  captured.url?.searchParams.get("jewish") === "Zmanim-Halachic-Times.htm",
  "the jewish= table selector is passed verbatim",
);
check(captured.url?.searchParams.get("aid") === null, "no aid parameter — confirmed by hand not to be required");

// The four parameters whose absence returned 91 days and zero candle
// lighting. Asserted individually, by value, because "all present" was
// true of the broken request too — it had none of them.
check(captured.url?.searchParams.get("before") === "18", "before=18 (candle-lighting minutes before sunset)");
check(captured.url?.searchParams.get("after") === "42", "after=42");
check(captured.url?.searchParams.get("ShabbosEnds") === "1", "ShabbosEnds=1");
check(captured.url?.searchParams.get("bdef") === "0", "bdef=0");

// Case is part of the contract in BOTH directions — see the adapter's own
// note. `locationid` must not become `locationId` (silently served
// Brooklyn) and `ShabbosEnds` must not become `shabbosends` for tidiness.
check(
  captured.url?.searchParams.get("locationId") === null && captured.url?.searchParams.get("locationType") === null,
  "locationid/locationtype are lowercase — the camelCase spellings are absent, not merely equivalent",
);
check(
  captured.url?.searchParams.get("shabbosends") === null,
  "ShabbosEnds keeps its capitals — the lowercased spelling is absent",
);

// The deliberate format mismatch: hyphens for tdate, slashes for the
// range. This is the single most "tidy-able" thing in the request and
// sending ISO for all three is what the broken call did.
check(captured.url?.searchParams.get("tdate") === "9-10-2026", "tdate is M-D-YYYY with hyphens", captured.url?.searchParams.get("tdate"));
check(captured.url?.searchParams.get("startdate") === "9/10/2026", "startdate is M/D/YYYY with slashes", captured.url?.searchParams.get("startdate"));
check(captured.url?.searchParams.get("enddate") === "12/10/2026", "enddate is M/D/YYYY with slashes", captured.url?.searchParams.get("enddate"));
check(
  (captured.url?.search ?? "").includes("startdate=9%2F10%2F2026"),
  "the slashes go on the wire percent-encoded, which is what the verified request sent",
);

console.log("\n-- the span, verified from the response's own EndDate ------");

check(dates.length === 92, "92 days parsed", String(dates.length));
check(result.firstDate === "2026-09-10" && result.lastDate === "2026-12-10",
  "the span runs 9/10/2026 to 12/10/2026", `${result.firstDate} -> ${result.lastDate}`);
check(result.echoedEndDate === "12/10/2026",
  "chabad.org echoes back the SAME EndDate it was asked for — the range was honoured, not coerced",
  String(result.echoedEndDate));

// Continuity, not just a count: 92 days with a hole in the middle and two
// duplicated is also "92".
const gaps: string[] = [];
for (let i = 1; i < dates.length; i += 1) {
  const previous = new Date(`${dates[i - 1]}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() + 1);
  if (previous.toISOString().slice(0, 10) !== dates[i]) gaps.push(`${dates[i - 1]} -> ${dates[i]}`);
}
check(gaps.length === 0, "no gaps — every calendar day in the span is present exactly once", gaps.join(", "));

check(
  dates.every((date) => date in rawResponseByDate),
  "every day is kept in rawResponseByDate for zmanim_cache.raw_response",
);
const slice = rawResponseByDate["2026-09-11"] as Record<string, unknown>;
check(
  Boolean(slice?.Day) && Boolean(slice?.Footnotes) && slice?.LocationName === "Saint Petersburg, FL 33701",
  "a raw slice carries its own day plus the response-level metadata a day can't be read without",
);

console.log("\n-- the type vocabulary, and nothing unclassified ------------");

const EXPECTED_TYPES = [
  "AlosHashachar", "CandleLighting", "Chatzos", "ChatzosNight", "EarliestTefillin",
  "LatestShema", "LatestTefillah", "MinchahGedolah", "MinchahKetanah", "NetzHachamah",
  "PlagHaminchah", "ShaahZmanit", "ShabbatEndTime", "Shkiah", "Tzeis",
];
check(
  JSON.stringify(result.essentialZmanTypes) === JSON.stringify(EXPECTED_TYPES),
  "15 distinct EssentialZmanType, exactly the expected set",
  result.essentialZmanTypes.join(","),
);
// 15, not the 13 daily zmanim plus CandleLighting: `EarliestTefillin`
// ("Earliest Tallit") is in the response and was not in the list this
// work started from.
check(
  result.essentialZmanTypes.includes("EarliestTefillin"),
  "EarliestTefillin is present — a 15th type, mapped to misheyakir rather than dropped",
);

check(
  result.essentialZmanTypes.every(
    (type) => type in CANONICAL_BY_ESSENTIAL_ZMAN_TYPE || type in UNMAPPED_ESSENTIAL_ZMAN_TYPES,
  ),
  "every type in the response is classified — either it has a canonical id or it is a declared gap",
);
check(
  Object.keys(UNMAPPED_ESSENTIAL_ZMAN_TYPES).every((type) => !(type in CANONICAL_BY_ESSENTIAL_ZMAN_TYPE)),
  "the two tables don't overlap — nothing is both mapped and declared unmapped",
);
check(
  JSON.stringify(Object.keys(UNMAPPED_ESSENTIAL_ZMAN_TYPES).sort()) ===
    JSON.stringify(["AlosHashachar", "LatestShema", "LatestTefillah", "ShaahZmanit", "Tzeis"]),
  "the declared gaps are exactly the five types §5c has no honest id for",
  Object.keys(UNMAPPED_ESSENTIAL_ZMAN_TYPES).sort().join(","),
);

console.log("\n-- all thirteen daily zmanim land on every day --------------");

// Nightfall counts once: Tzeis and ShabbatEndTime are mutually exclusive
// in the response, so a per-day list asserting both would fail on every
// Shabbos.
const ALWAYS = [
  "chabad:AlosHashachar", "misheyakir", "netz", "chabad:LatestShema", "chabad:LatestTefillah",
  "chatzos", "mincha_gedola", "mincha_ketana", "plag_hamincha", "shkia",
  "chatzos_laila", "chabad:ShaahZmanit",
];
const missing = dates.filter((date) => ALWAYS.some((id) => !(id in times[date])));
check(missing.length === 0, "the twelve every-day ids are on all 92 days — the thirteenth is nightfall, below", missing.slice(0, 5).join(","));

const withTzeis = dates.filter((date) => "chabad:Tzeis" in times[date]);
const withShabbosEnds = dates.filter((date) => "shabbos_ends" in times[date]);
check(withTzeis.length === 75 && withShabbosEnds.length === 17,
  "75 days carry a plain nightfall, 17 carry a Shabbos/Yom Tov end time",
  `${withTzeis.length} + ${withShabbosEnds.length}`);
check(
  withTzeis.length + withShabbosEnds.length === 92 &&
    !dates.some((date) => "chabad:Tzeis" in times[date] && "shabbos_ends" in times[date]),
  "and they are mutually exclusive — exactly one nightfall per day, relabelled rather than doubled",
);

console.log("\n-- candle lighting -----------------------------------------");

const candleDates = dates.filter((date) => "candle_lighting" in times[date]);
check(candleDates.length === 14, "14 dates carry candle lighting across the 92 days", String(candleDates.length));
check(
  JSON.stringify(candleDates) ===
    JSON.stringify([
      "2026-09-11", "2026-09-18", "2026-09-20", "2026-09-25", "2026-10-02", "2026-10-09",
      "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13", "2026-11-20",
      "2026-11-27", "2026-12-04",
    ]),
  "and they are the thirteen Fridays plus Erev Yom Kippur on a Sunday (9/20)",
  candleDates.join(","),
);
check(result.candleLightingDates.length === 14, "the reported candleLightingDates agrees with the parsed times");

const erevRoshHashanah = clock("2026-09-11", "candle_lighting");
check(erevRoshHashanah?.iso === "2026-09-11T23:22:00.000Z",
  "7:22 PM on 9/11 in America/New_York (EDT, UTC-4) is 23:22 UTC — built from DisplayDate + Zman + timezone",
  erevRoshHashanah?.iso);
check(erevRoshHashanah?.display === "7:22 PM",
  "display is Chabad's own rendered string verbatim, never re-formatted (§5c: never re-round provider output)",
  erevRoshHashanah?.display);

// `before=18` provably took effect, measured off the parsed instants
// rather than trusted from the parameter — and echoed independently in
// LocationDetails.
const offsets = new Set(
  candleDates.map((date) => {
    const light = clock(date, "candle_lighting");
    const sunset = clock(date, "shkia");
    if (!light || !sunset) return NaN;
    return (new Date(sunset.iso).getTime() - new Date(light.iso).getTime()) / 60_000;
  }),
);
check(offsets.size === 1 && offsets.has(18),
  "every candle lighting is exactly 18 minutes before that day's sunset — before=18 took effect",
  [...offsets].join(","));
check(
  String(FIXTURE.LocationDetails).includes("18 mins. before sunset"),
  "and chabad.org echoes the same 18 back in LocationDetails",
);

console.log("\n-- FootnoteType is carried, and LightCandlesAfter is not ----");

// The second night of a two-day Yom Tov: candles lit after nightfall from
// an existing flame. Chabad files it as a ShabbatEndTime with a
// LightCandlesAfter footnote, so it never reaches `candle_lighting` — but
// the footnote is the only thing that says this row differs from the 14
// ordinary shabbos_ends rows, which is why it is cached rather than parsed
// and dropped.
for (const date of ["2026-09-12", "2026-09-26", "2026-10-03"]) {
  const ends = clock(date, "shabbos_ends");
  check(
    !("candle_lighting" in times[date]) && ends?.footnote?.type === "LightCandlesAfter",
    `${date}: no candle_lighting, and its shabbos_ends carries the LightCandlesAfter footnote`,
    JSON.stringify(ends?.footnote),
  );
}
check(
  clock("2026-09-12", "shabbos_ends")?.footnote?.text === "Light Candles after this time",
  "the footnote text is resolved from the response root's own Footnotes dictionary",
  clock("2026-09-12", "shabbos_ends")?.footnote?.text,
);
check(clock("2026-09-12", "shabbos_ends")?.iso === "2026-09-13T00:14:00.000Z",
  "and the time itself is kept — 8:14 PM on 9/12 EDT",
  clock("2026-09-12", "shabbos_ends")?.iso);

const laterMincha = dates.filter((date) => times[date]["mincha_gedola"]?.footnote?.type === "LaterMincha");
check(laterMincha.length === 48 && laterMincha[0] === "2026-10-20",
  "LaterMincha lands on mincha_gedola for the 48 short days from 10/20 on",
  `${laterMincha.length} days, first ${laterMincha[0]}`);

const menorah = dates.filter((date) =>
  Object.values(times[date]).some((zman) => zman.footnote?.type === "MenorahLighting"),
);
check(menorah.length === 6 && menorah[0] === "2026-12-04",
  "MenorahLighting appears from the start of Chanukah on 12/4",
  `${menorah.length} days, first ${menorah[0]}`);
check(
  times["2026-12-06"]?.["shkia"]?.footnote?.text?.includes("burn for at least 30 minutes") === true,
  "and its text comes through too — the menorah must burn 30 minutes past nightfall",
);

console.log("\n-- ShaahZmanit is a duration, not a clock time --------------");

const shaah = times["2026-09-10"]?.["chabad:ShaahZmanit"];
check(shaah !== undefined && !isClockZman(shaah),
  "chabad:ShaahZmanit is present and is NOT a clock zman");
check(shaah !== undefined && !isClockZman(shaah) && shaah.durationSeconds === 62 * 60 + 51,
  '"62:51 min." is 3771 seconds — MM:SS, so 62 minutes 51 seconds',
  shaah && !isClockZman(shaah) ? String(shaah.durationSeconds) : undefined);
check(shaah?.display === "62:51 min.", "its display keeps Chabad's own string, units and all", shaah?.display);
check(shaah !== undefined && !("iso" in shaah),
  "it has no iso at all — nothing can accidentally read it as an instant");
check(
  dates.every((date) => {
    const value = times[date]["chabad:ShaahZmanit"];
    return value !== undefined && !isClockZman(value);
  }),
  "and it is a duration on all 92 days, never once parsed as 62 o'clock",
);

console.log("\n-- the Nov 1 DST fall-back, testable for the first time -----");

const before = clock("2026-10-31", "netz");
const after = clock("2026-11-01", "netz");
check(before?.display === "7:41 AM" && after?.display === "6:42 AM",
  "sunrise reads 7:41 AM on 10/31 and 6:42 AM on 11/1 — a 59-minute jump backwards on the wall clock",
  `${before?.display} -> ${after?.display}`);
check(before?.iso === "2026-10-31T11:41:00.000Z", "10/31 7:41 AM is EDT (UTC-4) — 11:41 UTC", before?.iso);
check(after?.iso === "2026-11-01T11:42:00.000Z", "11/1 6:42 AM is EST (UTC-5) — 11:42 UTC", after?.iso);
check(
  before && after
    ? (new Date(after.iso).getTime() - new Date(before.iso).getTime()) / 60_000 === 24 * 60 + 1
    : false,
  "so real elapsed time between the two sunrises is 24h 1m: the IANA zone applied EDT to one day and EST to the next",
);

console.log("\n-- ChatzosNight belongs to the FOLLOWING night --------------");

// This is what proves it, and the DST transition is the only thing that
// can: on 11/1 the midpoint of the night that follows is 12:14 AM EST,
// while the midpoint of the night that precedes it is 1:13 AM EDT. An
// hour apart, for once.
const midnight = times["2026-11-01"]?.["chatzos_laila"];
check(midnight !== undefined && isClockZman(midnight) && midnight.display === "12:14 AM",
  "11/1's chatzos_laila reads 12:14 AM — the following night's midpoint, not the preceding night's 1:13 AM");
check(clock("2026-11-01", "chatzos_laila")?.iso === "2026-11-02T05:14:00.000Z",
  "so its instant is 12:14 AM EST on 11/2 — a day after the row it is filed under",
  clock("2026-11-01", "chatzos_laila")?.iso);
check(clock("2026-09-10", "chatzos_laila")?.iso === "2026-09-11T05:27:00.000Z",
  "same rollover on an ordinary day: 1:27 AM on the row for 9/10 is 9/11 EDT",
  clock("2026-09-10", "chatzos_laila")?.iso);
check(clock("2026-10-31", "chatzos_laila")?.iso === "2026-11-01T05:14:00.000Z",
  "and 10/31's 1:14 AM resolves to the FIRST of the two 1:14 AMs on 11/1 (EDT), which is the solar midpoint",
  clock("2026-10-31", "chatzos_laila")?.iso);
check(
  dates.every((date) => {
    const value = times[date]["chatzos_laila"];
    return value !== undefined && isClockZman(value) && value.iso.slice(0, 10) !== date;
  }),
  "every one of the 92 chatzos_laila instants falls on the day after its own cache row — the one place date and iso differ",
);

// Nothing else rolls. A morning zman reading AM stays on its own day,
// which is the whole reason the rule is per-type and not per-clock.
check(
  dates.every((date) =>
    ["chabad:AlosHashachar", "netz", "misheyakir"].every((id) => clock(date, id)?.iso.slice(0, 10) === date),
  ),
  "and the morning zmanim, which also read AM, do NOT roll — dawn and sunrise stay on their own date",
);

console.log("\n-- location verification stays load-bearing -----------------");

check(result.location === "Saint Petersburg, FL 33701", "LocationName comes back as the requested place", result.location);
check(FIXTURE.LocationId === null,
  "LocationId is null even on a correctly-resolved response, so it cannot be the check");

// A camelCased parameter would return Brooklyn: a completely normal
// response for the wrong city, identical in every respect but this one
// string. Refusing it sends the widget down §5c's Hebcal fallback, which
// computes the right city's times from the org's own coordinates.
const brooklyn = { ...FIXTURE, LocationName: "Brooklyn, NY 11213" };
const restoreBrooklyn = stubFetch(brooklyn);
await expectThrow(
  "a response for another city is refused rather than cached",
  () => fetchChabadZmanim(REQUEST),
  'asked for 33701 but the response is for "Brooklyn, NY 11213"',
);
restoreBrooklyn();

const nameless = { ...FIXTURE, LocationName: null };
const restoreNameless = stubFetch(nameless);
await expectThrow(
  "a response with no LocationName at all is refused too — there is nothing to verify against",
  () => fetchChabadZmanim(REQUEST),
  "no LocationName in the response",
);
restoreNameless();

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
