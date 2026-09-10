/**
 * DIAGNOSTIC, NOT A TEST. Makes real requests to chabad.org's published
 * candle-lighting embed, so it is deliberately not part of `npm test`.
 *
 * TWO JOBS:
 *
 * 1. HOW FAR AHEAD DOES `weeks` GO? **ANSWERED: it caps at 4.** Measured
 *    at two values — weeks=13 and weeks=52 both return byte-identical
 *    responses to weeks=4, with the response's own final URL rewritten to
 *    weeks=4. Larger values are silently coerced, never rejected. The
 *    warming constant is now a literal 4 (WARM_WEEKS in
 *    lib/zmanim/warm.ts). This script is kept so the finding can be
 *    re-checked if the endpoint ever changes: a cap shows up here as a
 *    plateau in the entry count and last date across the four values.
 *
 * 2. CAPTURE A REAL RESPONSE for the parser's fixture. Each body is written
 *    verbatim to /tmp/chabad-embed-<weeks>w.js — no unwrapping, no
 *    reformatting. The parser is written against the captured bytes, not
 *    against a description of them: the last adapter for this provider was
 *    written from a described shape and a real response invalidated two of
 *    its core assumptions.
 *
 * Run it where the network works:
 *   npm run probe:chabad-embed            # ZIP 33701
 *   npm run probe:chabad-embed -- 11213
 */

import { writeFileSync } from "node:fs";

const ENDPOINT = "https://www.chabad.org/tools/shared/candlelighting/candlelighting.js.asp";
const zip = process.argv[2] ?? "33701";

/*
 * LOWERCASE PARAMETER NAMES, AND THIS IS NOT A STYLE CHOICE.
 *
 * Chabad's query parameter names are case-sensitive in the worst possible
 * way: `locationid` and `locationtype` work, while `locationId` and
 * `locationType` are SILENTLY IGNORED — the endpoint falls back to a
 * default location (Brooklyn) and returns a completely normal-looking
 * response for the wrong city, with no error and no warning. Verified by
 * hand: the same ZIP and the same URL, differing only in capitalization,
 * returned Saint Petersburg vs. Brooklyn.
 *
 * Every other identifier in this codebase is camelCase, so this is exactly
 * what a future tidy-up "fixes" — and the failure it causes is a shul's
 * board showing another city's candle lighting, which nothing in the
 * product would flag. Do not rename these. The parser verifies the
 * returned location against the requested ZIP for the same reason.
 */
function embedUrl(weeks: number): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("locationid", zip);
  url.searchParams.set("locationtype", "2");
  url.searchParams.set("ln", "2");
  url.searchParams.set("weeks", String(weeks));
  return url;
}

/** Cheap structural counts straight off the raw body — deliberately not the
 *  real parser, which doesn't exist yet and which this script's captures
 *  are meant to inform. */
function survey(body: string) {
  const dates = [...body.matchAll(/class=\\?["']CLdate\\?["'][^>]*>(.*?)<\\?\/div>/gi)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").replace(/\\n/g, " ").replace(/\s+/g, " ").trim(),
  );
  const times = [...body.matchAll(/class=\\?["']CLTime\\?["'][^>]*>(.*?)<\\?\/div>/gi)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").replace(/\\n/g, " ").replace(/\s+/g, " ").trim(),
  );

  // Which of the three phrasings appear, plus anything that matches none of
  // them — an unrecognised phrasing has to surface, not be dropped.
  const phrasing = (text: string) =>
    /light .*candles at /i.test(text)
      ? "at (candle_lighting)"
      : /light .*candles after /i.test(text)
        ? "after (NOT candle_lighting)"
        : /(shabbat|holiday) ends/i.test(text)
          ? "ends (shabbos_ends)"
          : "UNRECOGNISED";

  const buckets = new Map<string, number>();
  for (const t of times) buckets.set(phrasing(t), (buckets.get(phrasing(t)) ?? 0) + 1);

  return { dates, times, buckets };
}

function daysBetween(first: string, last: string): string {
  const a = Date.parse(first.replace(/^[A-Za-z]+,\s*/, ""));
  const b = Date.parse(last.replace(/^[A-Za-z]+,\s*/, ""));
  if (Number.isNaN(a) || Number.isNaN(b)) return "unparseable";
  return `${Math.round((b - a) / 86_400_000) + 1} days`;
}

console.log(`ZIP ${zip} — chabad.org published candle-lighting embed\n`);

for (const weeks of [4, 13, 26, 52]) {
  const url = embedUrl(weeks);
  console.log(`=== weeks=${weeks}`);
  console.log(url.toString());

  try {
    const response = await fetch(url, { headers: { Accept: "*/*" } });
    const body = await response.text();

    if (!response.ok) {
      console.log(`  HTTP ${response.status} ${response.statusText}, ${body.length} bytes\n`);
      continue;
    }

    const path = `/tmp/chabad-embed-${weeks}w.js`;
    writeFileSync(path, body);

    const { dates, times, buckets } = survey(body);
    console.log(`  HTTP ${response.status}, ${body.length} bytes -> saved ${path}`);
    console.log(`  document.write wrapper present: ${/document\.write\s*\(/.test(body)}`);
    console.log(`  .CLdate entries: ${dates.length}   .CLTime entries: ${times.length}`);
    if (dates.length > 0) {
      console.log(`  first: ${dates[0]}`);
      console.log(`  last:  ${dates[dates.length - 1]}   (span ${daysBetween(dates[0], dates[dates.length - 1])})`);
    }
    console.log(`  phrasings: ${[...buckets].map(([k, n]) => `${k} x${n}`).join(", ") || "(none matched)"}`);

    // The heading the location check will read. Printed so a Brooklyn
    // fallback is obvious at a glance even before any parser exists.
    const heading = body.match(/(?:[A-Z][A-Za-z.\-' ]+,\s*[A-Z]{2}\s*\d{5})/);
    console.log(`  location in body: ${heading ? heading[0] : "NOT FOUND"}`);
    console.log(`  contains requested ZIP ${zip}: ${body.includes(zip)}`);
    console.log(`  attribution present: ${/Powered by Chabad\.org/i.test(body)}`);
    console.log("");
  } catch (cause) {
    console.log(`  request failed: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  }
}

console.log("Expect a plateau: 13 and 52 measured identical to 4, so all four rows should match.");
console.log("If a larger value ever grows the span, the cap moved — update WARM_WEEKS in lib/zmanim/warm.ts.");
