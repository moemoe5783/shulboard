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
 * THE 4-DAY 33710 FIXTURE IS BACK, and the reversal is on the record
 * rather than quiet. It was deleted with the reasoning that its
 * `TimeGroups[].Items[]` nesting was "a shape production never sees", so
 * keeping it would invite a parser fix back to it. That reasoning has
 * stopped holding for one specific reason: the nested shape is the ONLY
 * one that carries `HebrewTitle`, so the reader now parses both
 * deliberately, and the fixture has a real job — it is the only evidence
 * anywhere of what Hebrew names Chabad actually sends.
 * test/fixtures/chabad-zmanim-33710-nested-4day.json, restored verbatim
 * from git.
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

/** Only used by the mapping assertion below — the four ids §5c added for
 *  this data, spelled here so the test states the expectation rather than
 *  echoing whatever the table happens to say. */
const TYPE_TO_BAAL_HATANYA: Record<string, string> = {
  AlosHashachar: "alos_baal_hatanya",
  LatestShema: "sof_zman_shma_baal_hatanya",
  LatestTefillah: "sof_zman_tfila_baal_hatanya",
  Tzeis: "tzeis_baal_hatanya",
};

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
  JSON.stringify(Object.keys(UNMAPPED_ESSENTIAL_ZMAN_TYPES)) === JSON.stringify(["ShaahZmanit"]),
  "ShaahZmanit is the only declared gap left — §5c named the four Baal HaTanya ids for the others",
  Object.keys(UNMAPPED_ESSENTIAL_ZMAN_TYPES).join(","),
);
check(
  ["AlosHashachar", "LatestShema", "LatestTefillah", "Tzeis"].every(
    (type) => CANONICAL_BY_ESSENTIAL_ZMAN_TYPE[type] === `${TYPE_TO_BAAL_HATANYA[type]}`,
  ),
  "and those four map to the Baal HaTanya ids, not to the GRA or MGA ones they sit 1-2 minutes from",
  ["AlosHashachar", "LatestShema", "LatestTefillah", "Tzeis"]
    .map((t) => `${t}->${CANONICAL_BY_ESSENTIAL_ZMAN_TYPE[t]}`)
    .join(" "),
);

console.log("\n-- all thirteen daily zmanim land on every day --------------");

// Nightfall counts once: Tzeis and ShabbatEndTime are mutually exclusive
// in the response, so a per-day list asserting both would fail on every
// Shabbos.
const ALWAYS = [
  "alos_baal_hatanya", "misheyakir", "netz", "sof_zman_shma_baal_hatanya",
  "sof_zman_tfila_baal_hatanya", "chatzos", "mincha_gedola", "mincha_ketana",
  "plag_hamincha", "shkia", "chatzos_laila", "chabad:ShaahZmanit",
];
const missing = dates.filter((date) => ALWAYS.some((id) => !(id in times[date])));
check(missing.length === 0, "the twelve every-day ids are on all 92 days — the thirteenth is nightfall, below", missing.slice(0, 5).join(","));

const withTzeis = dates.filter((date) => "tzeis_baal_hatanya" in times[date]);
const withShabbosEnds = dates.filter((date) => "shabbos_ends" in times[date]);
check(withTzeis.length === 75 && withShabbosEnds.length === 17,
  "75 days carry a plain nightfall, 17 carry a Shabbos/Yom Tov end time",
  `${withTzeis.length} + ${withShabbosEnds.length}`);
check(
  withTzeis.length + withShabbosEnds.length === 92 &&
    !dates.some((date) => "tzeis_baal_hatanya" in times[date] && "shabbos_ends" in times[date]),
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

console.log("\n-- the provider's own label is cached with every value ------");

// Item 2 of this task: the board shows Chabad's words, so nothing
// downstream needs a label table. The strings come from the response
// root's GroupHeadings, not from the entries.
for (const [id, expected] of [
  ["netz", "Sunrise"],
  ["sof_zman_shma_baal_hatanya", "Latest Shema"],
  ["sof_zman_tfila_baal_hatanya", "Latest Shacharit"],
  ["misheyakir", "Earliest Tallit"],
  ["alos_baal_hatanya", "Dawn"],
  ["chatzos", "Midday"],
  ["mincha_gedola", "Earliest Mincha"],
  ["shkia", "Sunset"],
  ["tzeis_baal_hatanya", "Nightfall"],
  ["chatzos_laila", "Midnight"],
] as const) {
  check(clock("2026-09-10", id)?.label === expected,
    `${id} carries Chabad's own label "${expected}"`, clock("2026-09-10", id)?.label);
}
check(clock("2026-09-11", "candle_lighting")?.label === "Candle Lighting",
  "candle_lighting too, on a day that has one", clock("2026-09-11", "candle_lighting")?.label);
check(clock("2026-09-12", "shabbos_ends")?.label === "Shabbat Ends",
  "and shabbos_ends' label is what a substituted nightfall row will show",
  clock("2026-09-12", "shabbos_ends")?.label);

// "Latest<br />Shacharit" in the response — the tag is Chabad's own
// two-line column header, not part of the name.
check(
  FIXTURE.GroupHeadings.some((h: { EssentialTitle: string }) => h.EssentialTitle.includes("<br />")),
  "the fixture's own headings really do contain <br />, so the flattening is exercised",
);
check(
  dates.every((date) =>
    Object.values(times[date]).every((zman) => !(zman.label ?? "").includes("<")),
  ),
  "no cached label anywhere carries markup",
);
check(
  dates.every((date) => Object.values(times[date]).every((zman) => Boolean(zman.label))),
  "every value on every one of the 92 days has a label — no row would fall back to house wording",
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

/*
 * THE REGRESSION THIS PAIR OF ROWS CAUGHT, and the reason lib/zmanim/time.ts
 * now makes two passes instead of one.
 *
 * 11/1 falls back at 2 AM = 06:00 UTC. A one-pass offset-by-round-trip
 * reads the zone's offset at the GUESS (05:27Z for a 5:27 AM alos, which
 * is still EDT — the transition is 33 minutes away) and applies it to the
 * ANSWER four hours later, which is EST. Every local time between 2 AM and
 * 6 AM on a fall-back day was therefore cached exactly an hour early. Alos
 * and misheyakir are in that window; netz at 6:42 AM is just past it,
 * which is why the two assertions above passed all along and this one did
 * not exist to fail.
 */
check(clock("2026-11-01", "alos_baal_hatanya")?.iso === "2026-11-01T10:27:00.000Z",
  "5:27 AM alos on the fall-back day is 10:27 UTC (EST), not 09:27 — the offset is read at the answer, not the guess",
  clock("2026-11-01", "alos_baal_hatanya")?.iso);
check(clock("2026-11-01", "misheyakir")?.iso === "2026-11-01T10:58:00.000Z",
  "and 5:58 AM misheyakir is 10:58 UTC for the same reason",
  clock("2026-11-01", "misheyakir")?.iso);
check(
  ["2026-10-31", "2026-11-01", "2026-11-02"].every((date) => {
    const alos = clock(date, "alos_baal_hatanya");
    const sunrise = clock(date, "netz");
    return Boolean(alos && sunrise) && new Date(alos!.iso) < new Date(sunrise!.iso);
  }),
  "and alos still precedes netz on every day around the transition — an hour of drift would have inverted them",
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
/*
 * BY LOCAL CALENDAR DATE IN THE SHUL'S ZONE, not by slicing the ISO
 * string. Those agree here — America/New_York is west of Greenwich, so a
 * 1:27 AM local instant has a UTC date one day ahead and a slice reads the
 * rollover correctly — and they disagree east of it, where 01:30 local can
 * be 23:30 UTC the previous day. The slice version of this assertion
 * failed the first time it was pointed at Europe/Zurich, on values that
 * were entirely correct; scripts/test-zmanim-international.ts keeps that
 * failure as its own assertion. This is the honest expression of the rule
 * in either hemisphere.
 */
const localDate = (instant: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REQUEST.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};
check(
  dates.every((date) => {
    const value = times[date]["chatzos_laila"];
    return value !== undefined && isClockZman(value) && localDate(new Date(value.iso)) !== date;
  }),
  "every one of the 92 chatzos_laila instants falls on the day after its own cache row — the one place date and iso differ",
);

// Nothing else rolls. A morning zman reading AM stays on its own day,
// which is the whole reason the rule is per-type and not per-clock.
check(
  dates.every((date) =>
    ["alos_baal_hatanya", "netz", "misheyakir"].every((id) => clock(date, id)?.iso.slice(0, 10) === date),
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
  "a ZIP response for another city is refused rather than cached",
  () => fetchChabadZmanim(REQUEST),
  'asked for ZIP 33701 but the response is for "Brooklyn, NY 11213"',
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

console.log("\n-- a city id verifies against its searched Title ------------");

/*
 * THE GAP THIS CLOSES. A `locationtype=1` response carries no id to match
 * and `LocationId` comes back null, so until `Get_Locations` existed there
 * was nothing to check a city id against — "Brooklyn, NY" is a perfectly
 * normal-looking answer to a request that was supposed to be Lugano, and
 * the settings form said so where the field would have been.
 *
 * These reuse the 33701 fixture body and vary only the LocationName, which
 * is the one field the check reads. That is the same thing the ZIP
 * assertions above do, and it is legitimate here for the same reason: a
 * wrong-location response is byte-for-byte normal apart from that string.
 */
const CITY = {
  locationId: "872",
  locationType: "1" as const,
  expectedName: "Lugano, Switzerland",
  startDate: "2026-09-10",
  endDate: "2026-12-10",
  timeZone: "Europe/Zurich",
};

for (const [servedName, label] of [
  ["Lugano, Switzerland", "the exact Title"],
  ["Lugano,  Switzerland", "the Title with chabad.org's own doubled space"],
  ["LUGANO, SWITZERLAND", "a different case"],
  ["Lugano TI, Switzerland", "a region spelled differently — the city token is what is compared"],
] as const) {
  const restoreCity = stubFetch({ ...FIXTURE, LocationName: servedName });
  const result = await fetchChabadZmanim(CITY);
  restoreCity();
  check(result.location === servedName, `city id accepted with ${label}`, servedName);
}

for (const [servedName, label] of [
  ["Brooklyn, NY 11213", "the default location a case-wrong parameter serves"],
  ["Zurich, Switzerland", "the right country, the wrong city"],
] as const) {
  const restoreCity = stubFetch({ ...FIXTURE, LocationName: servedName });
  await expectThrow(
    `city id REFUSED when served ${label}`,
    () => fetchChabadZmanim(CITY),
    `asked for "Lugano, Switzerland" (locationid 872) but the response is for "${servedName}"`,
  );
  restoreCity();
}

{
  // An id stored before the search existed has no name to verify. Logged
  // loudly, not refused: that configuration worked unverified before this
  // check, and blanking a board to enforce a check it predates would be
  // this change breaking what it was meant to protect.
  const restoreCity = stubFetch({ ...FIXTURE, LocationName: "Brooklyn, NY 11213" });
  const result = await fetchChabadZmanim({ ...CITY, expectedName: null });
  restoreCity();
  check(result.location === "Brooklyn, NY 11213",
    "a city id with NO stored name is cached unverified rather than refused",
    result.location);
}

console.log("\n-- the NESTED shape, and the Hebrew only it carries ---------");

/*
 * WHICH PARAMETER SWITCHES THE SHAPE IS UNKNOWN — see the adapter's own
 * note. Two captures exist: a 92-day request returned flat `Zmanim[]` with
 * no Hebrew anywhere, and a 4-day request returned nested
 * `TimeGroups[].Items[]` with `HebrewTitle` on every group. Their roots are
 * structurally identical, `IsAdvanced: false` in both, so it is a per-day
 * difference and not a whole-response mode.
 *
 * Which means the reader has to handle both, and this is where that is
 * proved against the real nested body rather than a reconstruction.
 */
const NESTED = JSON.parse(
  readFileSync(fileURLToPath(new URL("../test/fixtures/chabad-zmanim-33710-nested-4day.json", import.meta.url)), "utf8"),
);

const restoreNested = stubFetch(NESTED);
const nested = await fetchChabadZmanim({
  locationId: "33710",
  locationType: "2",
  startDate: "2026-09-10",
  endDate: "2026-09-13",
  timeZone: "America/New_York",
});
restoreNested();

const nestedClock = (date: string, id: string) => {
  const value = nested.times[date]?.[id];
  return value && isClockZman(value) ? value : undefined;
};

check(Object.keys(nested.times).length === 4, "all four nested days parsed",
  String(Object.keys(nested.times).length));
check(
  JSON.stringify(nested.essentialZmanTypes.slice(0, 4)) ===
    JSON.stringify(["AlosHashachar", "CandleLighting", "Chatzos", "ChatzosNight"]),
  "and the same EssentialZmanType vocabulary comes out of the nested shape",
  nested.essentialZmanTypes.join(","),
);
check(nestedClock("2026-09-11", "candle_lighting")?.iso === "2026-09-11T23:22:00.000Z",
  "7:22 PM on 9/11 builds the same instant from either shape — the group's item, not a flat entry",
  nestedClock("2026-09-11", "candle_lighting")?.iso);
check(nestedClock("2026-09-11", "chatzos_laila")?.iso === "2026-09-12T05:27:00.000Z",
  "and the chatzos halayla rollover holds through the nested reader too",
  nestedClock("2026-09-11", "chatzos_laila")?.iso);

// THE HEBREW. Chabad's own names, from the group, for every type.
for (const [id, hebrew] of [
  ["alos_baal_hatanya", "עלות השחר"],
  ["misheyakir", "משיכיר"],
  ["netz", "הנץ החמה"],
  ["sof_zman_shma_baal_hatanya", "סוף זמן קריאת שמע"],
  ["sof_zman_tfila_baal_hatanya", "סוף זמן תפילה"],
  ["chatzos", "חצות היום"],
  ["mincha_gedola", "מנחה גדולה"],
  ["mincha_ketana", "מנחה קטנה"],
  ["plag_hamincha", "פלג המנחה"],
  ["candle_lighting", "הדלקת נרות"],
  ["shkia", "שקיעת החמה"],
  ["tzeis_baal_hatanya", "צאת הכוכבים"],
  ["chatzos_laila", "חצות הלילה"],
] as const) {
  check(nestedClock("2026-09-11", id)?.hebrewLabel === hebrew,
    `${id} carries Chabad's own Hebrew "${hebrew}"`, nestedClock("2026-09-11", id)?.hebrewLabel);
}
check(nestedClock("2026-09-11", "netz")?.label === "Sunrise",
  "and the English still comes through beside it", nestedClock("2026-09-11", "netz")?.label);

/*
 * THE HEBREW IS PER-DAY, NOT PER-TYPE, and this is the assertion that says
 * why it is cached on the value rather than harvested once. `ShabbatEndTime`
 * came back as "הדלקת נרות" — candle lighting — on 9/12, where the footnote
 * is `LightCandlesAfter` and the time is when to light on the second night
 * of a two-day Yom Tov; and as "צאת החג", the festival ends, for the same
 * type the next day. Chabad's Hebrew carries a halachic distinction its own
 * English flattens to "Shabbat Ends" on both days.
 */
check(nestedClock("2026-09-12", "shabbos_ends")?.hebrewLabel === "הדלקת נרות",
  "9/12's Shabbos-end row is Hebrew-labelled as candle lighting — the second night of a two-day Yom Tov",
  nestedClock("2026-09-12", "shabbos_ends")?.hebrewLabel);
check(nestedClock("2026-09-13", "shabbos_ends")?.hebrewLabel === "צאת החג",
  "and 9/13's as the festival ending — same type, same English, different Hebrew",
  nestedClock("2026-09-13", "shabbos_ends")?.hebrewLabel);
check(
  nestedClock("2026-09-12", "shabbos_ends")?.label === nestedClock("2026-09-13", "shabbos_ends")?.label,
  "which the English does NOT distinguish, so harvesting one Hebrew name per type would lose it",
  nestedClock("2026-09-12", "shabbos_ends")?.label,
);
check(nestedClock("2026-09-12", "shabbos_ends")?.footnote?.type === "LightCandlesAfter",
  "and the footnote reads from the group, where the nested shape puts it");

// The flat 92-day fixture has none, which is the gap the setting has to
// cope with rather than paper over.
check(
  dates.every((date) => Object.values(times[date]).every((zman) => zman.hebrewLabel === undefined)),
  "the flat 92-day response carries NO Hebrew on any row — the setting falls back to English there",
);

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
