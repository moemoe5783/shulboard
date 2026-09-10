/**
 * DIAGNOSTIC, NOT A TEST. Makes real requests to chabad.org, so it is
 * deliberately not part of `npm test` and not run in CI. This project's
 * own sandbox cannot run it either — the egress proxy refuses CONNECT to
 * www.chabad.org — so it exists to be run somewhere the network works.
 *
 * WHAT IT ANSWERS NOW. The diagnosis this script was originally written
 * for is closed: a 91-day warm that returned 91 days and zero candle
 * lighting was missing four trailing parameters (`before`, `after`,
 * `ShabbosEnds`, `bdef`) and was sending ISO dates where the endpoint
 * wants M-D-YYYY for `tdate` and M/D/YYYY for the range. With those fixed
 * the endpoint returns the whole span with candle lighting on every Erev
 * Shabbos and Yom Tov.
 *
 * The one thing still genuinely unknown is where the span stops. 92 days
 * is verified by hand; nothing has established it as a ceiling, and the
 * embed's own `weeks` parameter is a warning that this endpoint family
 * silently coerces rather than rejecting. So this probe asks for four
 * spans and prints, for each, how many days came back and what the
 * response's own `EndDate` says. Two rows whose `endDate` matches their
 * request and two whose don't is the shape of a cap; all four matching
 * means there isn't one within a year.
 *
 * Run it where the network works:
 *   npm run probe:chabad            # ZIP 33710
 *   npm run probe:chabad -- 11213   # any US ZIP
 */

import { fetchChabadZmanim } from "../lib/zmanim/chabad-adapter.ts";

const zip = process.argv[2] ?? "33710";
const timeZone = "America/New_York";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date(`${iso(new Date())}T00:00:00Z`);
const plus = (days: number) => new Date(today.getTime() + days * 86_400_000);

console.log(`ZIP ${zip}, from ${iso(today)}, timezone ${timeZone}\n`);

// 92 is the verified span. 30 is a control — a request nobody doubts, so a
// failure there means something unrelated broke. 183 and 365 are the open
// question.
for (const days of [30, 92, 183, 365]) {
  const startDate = iso(today);
  const endDate = iso(plus(days - 1));
  process.stdout.write(`${String(days).padStart(3)} days requested (${startDate} .. ${endDate}): `);
  try {
    const result = await fetchChabadZmanim({ locationId: zip, locationType: "2", startDate, endDate, timeZone });
    const coerced = result.echoedEndDate === null ? "?" : result.lastDate === endDate ? "honoured" : "COERCED";
    console.log(
      `${Object.keys(result.times).length} days back, last ${result.lastDate}, ` +
        `EndDate ${result.echoedEndDate} — ${coerced}; ` +
        `${result.candleLightingDates.length} candle lightings; ` +
        `types ${result.essentialZmanTypes.length}`,
    );
  } catch (cause) {
    console.log(`threw: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
