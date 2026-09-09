/**
 * lib/zmanim/chabad-adapter.ts's own parsing logic, against a REAL
 * chabad.org response — no network, `fetch` stubbed to return the fixture.
 *
 * ORIGIN OF THE FIXTURE: test/fixtures/chabad-zmanim-33710-sep2026.json is
 * a hand-fetched real response for ZIP 33710 (Saint Petersburg, FL),
 * covering Thu 9/10/2026 through Sun 9/13/2026 — an ordinary Thursday
 * followed by Erev Rosh Hashanah and both days of Rosh Hashanah. It is not
 * reconstructed or self-authored; an earlier version of this suite used a
 * self-authored fixture and that fixture has been deleted, not kept
 * alongside this real one. This suite's whole job is proving the adapter's
 * parsing logic against that data, not against a guess.
 *
 * Run with: npm run test:chabad-adapter — not plain `node`. The module
 * under test imports `server-only`, which throws unless the `react-server`
 * export condition is set (Next's own server build sets it; a plain `node`
 * run needs `--conditions=react-server` — see the npm script).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchChabadZmanim } from "../lib/zmanim/chabad-adapter.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

const FIXTURE_PATH = fileURLToPath(new URL("../test/fixtures/chabad-zmanim-33710-sep2026.json", import.meta.url));
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

/* The adapter reads the body with `.text()` and parses it itself, so the
 * byte length is available to its diagnostic log line. The stub has to
 * match that, not `.json()`. The captured URL is asserted below — the gap
 * that let a wrong date format ship unnoticed was this suite never looking
 * at the request it was stubbing. */
const captured: { url: URL | null } = { url: null };

function stubFetch(body: unknown) {
  const original = globalThis.fetch;
  captured.url = null;
  globalThis.fetch = (async (input: URL | string) => {
    captured.url = new URL(String(input));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify(body),
    };
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
// per-day breakdown either way, so it could not tell a multi-day request
// which of its days each offset applies to even if it were self-consistent.
const REQUEST = {
  locationId: "33710",
  locationType: "2" as const,
  startDate: "2026-09-10",
  endDate: "2026-09-13",
  timeZone: "America/New_York",
};

const restore = stubFetch(FIXTURE);
const { times, rawResponseByDate } = await fetchChabadZmanim(REQUEST);
restore();

// ---- exactly one CandleLighting item across all 4 days -------------------

const datesWithCandleLighting = Object.keys(times).filter((date) => times[date]?.candle_lighting);
check(datesWithCandleLighting.length === 1, "exactly one date across all 4 days has a candle_lighting value",
  JSON.stringify(datesWithCandleLighting));
check(datesWithCandleLighting[0] === "2026-09-11", "that one date is 9/11 (Erev Rosh Hashanah), not any other day",
  datesWithCandleLighting[0]);

// ---- the value itself, built from DisplayDate + Zman + America/New_York --

const candleLighting = times["2026-09-11"]?.candle_lighting;
check(candleLighting?.iso === "2026-09-11T23:22:00.000Z",
  "7:22 PM on 9/11/2026 in America/New_York (EDT, UTC-4) is 23:22 UTC — built from DisplayDate + Zman + timezone, not item.Date",
  candleLighting?.iso);
check(candleLighting?.display === "7:22 PM", "display re-renders the same instant in the requested timezone",
  candleLighting?.display);

// ---- the regression case: 9/12's real "Candle Lighting after" item -------
//
// ZmanType "ShabbatEndTime", FootnoteType "LightCandlesAfter", Title
// "Candle Lighting after" — this is the actual item that would have
// false-matched under the old Name/Caption/Title/Type substring-on-"candle"
// logic, taken from the real fixture rather than invented for this test.

check(!("candle_lighting" in (times["2026-09-12"] ?? {})),
  "9/12's real ShabbatEndTime/LightCandlesAfter \"Candle Lighting after\" item is NOT matched as candle_lighting");
check(times["2026-09-12"] === undefined,
  "9/12 has no candle_lighting entry at all — absent, not a stray key under a shared object",
  JSON.stringify(times["2026-09-12"]));

// ---- absent from the other two days too -----------------------------------

check(times["2026-09-10"] === undefined, "9/10 (an ordinary Thursday, no candle lighting) has no times entry");
check(times["2026-09-13"] === undefined, "9/13 (second day Rosh Hashanah, Holiday Ends only) has no times entry");

// ---- every real day is still kept in rawResponseByDate, matched or not ---

check(
  ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"].every((date) => date in rawResponseByDate),
  "all 4 real days are kept in rawResponseByDate regardless of whether anything in them matched",
);

// ---- the outgoing request itself ----------------------------------------
//
// This suite previously asserted nothing about the URL, which is exactly
// how the three date parameters came to be sent in ISO format while the
// hand-verified working request uses M-D-YYYY for `tdate` and M/D/YYYY for
// `startdate`/`enddate`. These checks pin the parts that are settled; the
// date FORMAT is a live diagnosis and is deliberately not asserted here
// yet, so this suite cannot claim a format is correct before a live call
// has shown which one is.

check(
  captured.url?.origin + (captured.url?.pathname ?? "") ===
    "https://www.chabad.org/webservices/zmanim/zmanim/Get_Zmanim",
  "the endpoint is chabad.org's Get_Zmanim, unchanged",
  captured.url?.origin + (captured.url?.pathname ?? ""),
);
check(captured.url?.searchParams.get("locationid") === "33710", "locationid carries the ZIP");
check(captured.url?.searchParams.get("locationtype") === "2", "locationtype=2 — a ZIP, never Chabad's opaque city numbering");
check(captured.url?.searchParams.get("save") === "1", "save=1");
check(
  captured.url?.searchParams.get("jewish") === "Zmanim-Halachic-Times.htm",
  "the jewish= table selector is passed verbatim",
  captured.url?.searchParams.get("jewish"),
);
check(captured.url?.searchParams.get("aid") === null, "no aid parameter — confirmed by hand not to be required");
check(
  ["tdate", "startdate", "enddate"].every((key) => Boolean(captured.url?.searchParams.get(key))),
  "all three date parameters are present and non-empty",
  ["tdate", "startdate", "enddate"].map((k) => `${k}=${captured.url?.searchParams.get(k)}`).join(" "),
);

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
