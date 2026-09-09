/**
 * lib/zmanim/chabad-embed.ts's parsing, against a REAL captured response —
 * no network, `fetch` stubbed to return the fixture.
 *
 * ORIGIN OF THE FIXTURE: test/fixtures/chabad-embed-33701-4w.js is the
 * verbatim body of
 * candlelighting.js.asp?locationid=33701&locationtype=2&ln=2&weeks=4,
 * fetched by hand in a browser. Not reconstructed, not reformatted — byte
 * for byte what chabad.org served, including the single-line
 * document.write wrapper and every &nbsp;.
 *
 * It happens to carry the whole three-way distinction this parser exists
 * for, in consecutive entries: 9/11 "at" (candle lighting), 9/12 "after"
 * (second night of Rosh Hashanah, lit from an existing flame — NOT candle
 * lighting), 9/13 "Holiday Ends". It also carries two phrasings the brief
 * for this work did not mention, which is exactly why the fixture is real.
 *
 * Run with: npm run test:chabad-embed — not plain `node`. The module under
 * test imports `server-only`, which throws unless the `react-server`
 * export condition is set (see the npm script).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchChabadEmbed } from "../lib/zmanim/chabad-embed.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

const FIXTURE_PATH = fileURLToPath(new URL("../test/fixtures/chabad-embed-33701-4w.js", import.meta.url));
const FIXTURE = readFileSync(FIXTURE_PATH, "utf8");

const captured: { url: URL | null } = { url: null };

function stubFetch(body: string, status = 200) {
  const original = globalThis.fetch;
  captured.url = null;
  globalThis.fetch = (async (input: URL | string) => {
    captured.url = new URL(String(input));
    return { ok: status < 400, status, statusText: "", text: async () => body };
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// Saint Petersburg, FL is America/New_York — the org's own stored IANA
// zone, not read off the response, which carries no offset at all.
const REQUEST = { locationId: "33701", weeks: 4, timeZone: "America/New_York" };

const restore = stubFetch(FIXTURE);
const result = await fetchChabadEmbed(REQUEST);
restore();

// ---- the request, and the case-sensitivity trap -------------------------

check(
  captured.url?.searchParams.get("locationid") === "33701",
  "the ZIP goes in LOWERCASE locationid",
  captured.url?.search,
);
check(captured.url?.searchParams.get("locationtype") === "2", "and locationtype is lowercase too");
check(
  captured.url?.searchParams.get("locationId") === null &&
    captured.url?.searchParams.get("locationType") === null,
  "no camelCase locationId/locationType — those are silently ignored and fall back to Brooklyn",
);
check(captured.url?.searchParams.get("ln") === "2" && captured.url?.searchParams.get("weeks") === "4",
  "ln and weeks are passed through", captured.url?.search);

// The fixture's own heading link uses camelCase, which is what makes the
// lowercase request params look wrong to a future reader.
check(
  FIXTURE.includes("locationId=33701&locationType=2"),
  "the fixture's own heading link IS camelCase — the provider's markup endorses the spelling that breaks the request",
);

// ---- item 1: what weeks=4 actually returned -----------------------------

check(result.entries === 13, "weeks=4 returned 13 entries, not 4 — `weeks` is coverage, not a row count",
  String(result.entries));
check(result.firstDate === "2026-09-11", "first entry is Fri 9/11", result.firstDate);
check(result.lastDate === "2026-10-04", "last entry is Sun 10/4 — a 24-day span for weeks=4", result.lastDate);

// ---- item 5: the three-way distinction, in consecutive entries ----------

check(
  result.times["2026-09-11"]?.candle_lighting?.display === "7:22 PM",
  "9/11 \"Light Shabbat / Holiday Candles at&nbsp;7:22 PM\" -> candle_lighting 7:22 PM",
  result.times["2026-09-11"]?.candle_lighting?.display,
);
check(
  result.times["2026-09-11"]?.candle_lighting?.iso === "2026-09-11T23:22:00.000Z",
  "and 7:22 PM EDT is 23:22 UTC — built from the entry's own date plus the org's IANA zone",
  result.times["2026-09-11"]?.candle_lighting?.iso,
);

check(
  result.times["2026-09-12"]?.candle_lighting === undefined,
  "9/12 \"Light Holiday Candles after&nbsp;8:14 PM\" is NOT candle_lighting — second night, lit after nightfall",
  JSON.stringify(result.times["2026-09-12"]),
);
check(
  result.times["2026-09-12"] === undefined,
  "9/12 has no entry at all — the after-nightfall case is excluded, not stored under some other id",
);
check(
  !JSON.stringify(result.times).includes("8:14"),
  "8:14 PM appears nowhere in the parsed output",
);

check(
  result.times["2026-09-13"]?.shabbos_ends?.display === "8:12 PM",
  "9/13 \"Holiday Ends 8:12 PM\" -> shabbos_ends (plan.md §5c's canonical id)",
  result.times["2026-09-13"]?.shabbos_ends?.display,
);
check(
  result.times["2026-09-13"]?.candle_lighting === undefined,
  "and an Ends entry never lands under candle_lighting",
);

// ---- the two phrasings the brief didn't mention -------------------------

check(
  result.times["2026-09-18"]?.candle_lighting?.display === "7:14 PM",
  "\"Light Candles at\" (a plain Friday) -> candle_lighting",
  result.times["2026-09-18"]?.candle_lighting?.display,
);
check(
  result.times["2026-09-20"]?.candle_lighting?.display === "7:11 PM",
  "\"Light Holiday Candles at\" (Erev Yom Kippur, a Sunday) -> candle_lighting — a third `at` phrasing",
  result.times["2026-09-20"]?.candle_lighting?.display,
);
check(
  result.times["2026-09-19"]?.shabbos_ends?.display === "8:05 PM",
  "\"Shabbat Ends\" and \"Holiday Ends\" both -> shabbos_ends",
  result.times["2026-09-19"]?.shabbos_ends?.display,
);

const candleLightingDates = Object.keys(result.times)
  .filter((date) => result.times[date].candle_lighting)
  .sort();
check(
  candleLightingDates.join(",") === "2026-09-11,2026-09-18,2026-09-20,2026-09-25,2026-10-02",
  "five candle lightings across the 13 entries, and the two `after` entries are not among them",
  candleLightingDates.join(","),
);

// ---- item 3: location verification is load-bearing ---------------------

check(result.location === "Saint Petersburg, FL 33701", "the heading's location is returned", result.location);

async function expectThrow(label: string, body: string, status = 200) {
  const undo = stubFetch(body, status);
  try {
    await fetchChabadEmbed(REQUEST);
    check(false, label, "did not throw");
  } catch (cause) {
    check(true, label, cause instanceof Error ? cause.message.slice(0, 110) : String(cause));
  } finally {
    undo();
  }
}

// The Brooklyn fallback: a real-shaped response for the wrong city. This is
// the one the case-sensitivity bug produces, and it must be refused.
await expectThrow(
  "a response whose heading is a DIFFERENT city is refused, not cached",
  FIXTURE.replace("Saint Petersburg, FL 33701", "Brooklyn, NY 11213"),
);
await expectThrow("a response with no location heading at all is refused", "document.write('<div>nothing</div>')");

// ---- item 2: an unrecognised phrasing fails loudly ---------------------

await expectThrow(
  "an unrecognised phrasing throws rather than being silently dropped",
  FIXTURE.replace("Light Shabbat / Holiday Candles at", "Kindle the lamps around"),
);
await expectThrow(
  "an entry with no time in it throws",
  FIXTURE.replace("Light Candles at&nbsp;7:14 PM", "Light Candles at&nbsp;sundown"),
);
await expectThrow(
  "an unparseable date throws",
  FIXTURE.replace("Friday, September 11, 2026", "Friday, Septober 11, 2026"),
);
await expectThrow("a body that isn't a document.write call is refused", "<html>not the embed</html>");
await expectThrow("a 503 throws rather than parsing an error page", FIXTURE, 503);

// "Shabbat" where "Saturday" would be — engine-independent, since the
// weekday word is dropped without being parsed.
{
  const undo = stubFetch(FIXTURE.replace("Shabbat, September 19, 2026", "Saturday, September 19, 2026"));
  const swapped = await fetchChabadEmbed(REQUEST);
  undo();
  check(
    swapped.times["2026-09-19"]?.shabbos_ends?.display === "8:05 PM",
    "\"Shabbat\" and \"Saturday\" as the weekday word parse identically — it is dropped, never validated",
  );
}

// ---- the raw body is kept verbatim for zmanim_cache.raw_response -------

check(result.raw === FIXTURE, "the untouched body is returned for raw_response, not the unwrapped HTML");

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
