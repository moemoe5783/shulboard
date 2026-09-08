/**
 * The Hebrew calendar computation layer — pure logic, no browser.
 *
 * Everything a Jewish-calendar widget needs before it ever touches the DOM:
 * the sunset-rollover Hebrew date, parsha lookup, Daf Yomi, and the upcoming
 * candle-lighting/Havdalah search. Dates below are fixed, real calendar dates
 * (not "today") so this suite means the same thing every time it runs.
 *
 * Run with: npm run test:hebrew
 */

import { effectiveHebrewDate } from "../lib/hebrew/civil-day.ts";
import { currentParsha } from "../lib/hebrew/parsha.ts";
import { dafYomiFor } from "../lib/hebrew/daf-yomi.ts";
import { upcomingCandleLighting, upcomingHavdalah } from "../lib/hebrew/candle-times.ts";
import { formatDaf, formatHebrewDate, formatParsha, formatTimeOfDay } from "../lib/hebrew/format.ts";
import { sunsetOn } from "../lib/hebrew/sunset.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

const CROWN_HEIGHTS = { latitude: 40.6694, longitude: -73.9422, timeZone: "America/New_York" };

// A normal midsummer Friday/Saturday, far from any holiday — 10/11 July 2026.
const FRIDAY_NOON = new Date(2026, 6, 10, 16, 0, 0); // noon EDT
const SHABBOS_MORNING = new Date(2026, 6, 11, 14, 0, 0); // 10am EDT

// ---- civil day + sunset rollover -----------------------------------------

{
  const midnight = effectiveHebrewDate(FRIDAY_NOON, CROWN_HEIGHTS, false);
  const rollover = effectiveHebrewDate(FRIDAY_NOON, CROWN_HEIGHTS, false);
  check(midnight.renderGematriya() === rollover.renderGematriya(), "midnight mode is stable at noon");
  check(midnight.render("en") === "25th of Tamuz, 5786", "civil day matches the calendar date", midnight.render("en"));
}

{
  // Late evening, after sunset — sunsetRollover should already show Shabbos.
  const sunset = sunsetOn(new Date(2026, 6, 10), CROWN_HEIGHTS);
  check(sunset !== null, "sunset resolves for a real location");
  const afterSunset = new Date(sunset!.getTime() + 5 * 60 * 1000);
  const noRollover = effectiveHebrewDate(afterSunset, CROWN_HEIGHTS, false);
  const withRollover = effectiveHebrewDate(afterSunset, CROWN_HEIGHTS, true);
  check(noRollover.render("en") === "25th of Tamuz, 5786", "midnight mode stays on the civil day after sunset");
  check(withRollover.render("en") === "26th of Tamuz, 5786", "sunset mode has already rolled to the next Hebrew day",
    withRollover.render("en"));
}

{
  // Broken/extreme coordinates should degrade to null, not throw.
  const sunset = sunsetOn(new Date(2026, 6, 10), { latitude: 89.9, longitude: 0, timeZone: "UTC" });
  check(sunset === null || sunset instanceof Date, "an extreme latitude degrades rather than throwing");
}

// ---- parsha ---------------------------------------------------------------

{
  const parsha = currentParsha(FRIDAY_NOON, CROWN_HEIGHTS);
  check(parsha.basename() === "Matot-Masei", "the Friday before a normal Shabbos shows the upcoming parsha", parsha.basename());
  const onShabbos = currentParsha(SHABBOS_MORNING, CROWN_HEIGHTS);
  check(onShabbos.basename() === "Matot-Masei", "and Shabbos morning itself shows the same parsha", onShabbos.basename());

  const formatted = formatParsha(parsha, { script: "both", nekudos: true });
  check(formatted.english === "Matot-Masei", "formatParsha's english half has no Parashat prefix", formatted.english ?? "");
  check(formatted.hebrew === "מַטּוֹת־מַסְעֵי", "formatParsha's hebrew half has no פרשת prefix either", formatted.hebrew ?? "");

  const noNikud = formatParsha(parsha, { script: "hebrew", nekudos: false });
  check(!/\p{Mn}/u.test(noNikud.hebrew ?? "x"), "nekudos: false strips the vowel points", noNikud.hebrew ?? "");
}

// ---- Hebrew date formatting -------------------------------------------

{
  const hdate = effectiveHebrewDate(FRIDAY_NOON, CROWN_HEIGHTS, false);

  const gematria = formatHebrewDate(hdate, { script: "hebrew", numerals: "gematria", nekudos: true, yearPrefix: false });
  check(gematria.hebrew === "כ״ה תַּמּוּז תשפ״ו", "gematria numerals, no ה׳, with nekudos", gematria.hebrew ?? "");

  const withHeh = formatHebrewDate(hdate, { script: "hebrew", numerals: "gematria", nekudos: true, yearPrefix: true });
  check(withHeh.hebrew === "כ״ה תַּמּוּז ה׳תשפ״ו", "the ה׳ toggle prepends it to the gematria year", withHeh.hebrew ?? "");

  const latinNumerals = formatHebrewDate(hdate, { script: "hebrew", numerals: "latin", nekudos: true, yearPrefix: true });
  check(latinNumerals.hebrew === "25 תַּמּוּז, 5786", "latin numerals ignore the ה׳ toggle entirely", latinNumerals.hebrew ?? "");

  const noNikud = formatHebrewDate(hdate, { script: "hebrew", numerals: "gematria", nekudos: false, yearPrefix: false });
  check(!/\p{Mn}/u.test(noNikud.hebrew ?? "x"), "nekudos: false strips vowel points from the date too", noNikud.hebrew ?? "");

  const both = formatHebrewDate(hdate, { script: "both", numerals: "latin", nekudos: true, yearPrefix: false });
  check(both.english === "25th of Tamuz, 5786", "both mode's english half", both.english ?? "");
  check(both.hebrew !== null, "both mode's hebrew half is also populated");

  const translit = formatHebrewDate(hdate, { script: "transliterated", numerals: "gematria", nekudos: true, yearPrefix: true });
  check(translit.hebrew === null, "transliterated mode has no hebrew half at all, regardless of other options");
}

// ---- Daf Yomi ---------------------------------------------------------

{
  const hdate = effectiveHebrewDate(FRIDAY_NOON, CROWN_HEIGHTS, false);
  const daf = dafYomiFor(hdate);
  check(daf !== null, "a daf yomi event exists for an ordinary date");
  check(daf!.daf.name === "Chullin" && daf!.daf.blatt === 71, "the specific daf matches a known value",
    `${daf!.daf.name} ${daf!.daf.blatt}`);

  const gematria = formatDaf(daf!.daf, { script: "hebrew", numerals: "gematria", nekudos: false });
  check(gematria.hebrew === "חולין ע״א", "daf yomi in hebrew script with gematria page number", gematria.hebrew ?? "");

  const latin = formatDaf(daf!.daf, { script: "hebrew", numerals: "latin", nekudos: false });
  check(latin.hebrew === "חולין 71", "hebrew tractate name with a latin page number — the axes are independent",
    latin.hebrew ?? "");

  const english = formatDaf(daf!.daf, { script: "transliterated", numerals: "latin", nekudos: false });
  check(english.english === "Chullin 71", "transliterated daf yomi", english.english ?? "");
}

// ---- candle lighting / Havdalah ----------------------------------------

{
  const candle = upcomingCandleLighting(FRIDAY_NOON, CROWN_HEIGHTS);
  check(candle !== null, "an upcoming candle lighting is found from Friday noon");
  check(
    candle!.eventTime.toISOString() === "2026-07-11T00:10:00.000Z",
    "candle lighting matches the known time for this date/location",
    candle!.eventTime.toISOString(),
  );
  check(formatTimeOfDay(candle!.eventTime, { hour12: true, timeZone: CROWN_HEIGHTS.timeZone }) === "8:10 PM",
    "formatted 12-hour candle lighting time",
    formatTimeOfDay(candle!.eventTime, { hour12: true, timeZone: CROWN_HEIGHTS.timeZone }));
  check(formatTimeOfDay(candle!.eventTime, { hour12: false, timeZone: CROWN_HEIGHTS.timeZone }) === "20:10",
    "formatted 24-hour candle lighting time",
    formatTimeOfDay(candle!.eventTime, { hour12: false, timeZone: CROWN_HEIGHTS.timeZone }));

  const havdalah = upcomingHavdalah(FRIDAY_NOON, CROWN_HEIGHTS);
  check(havdalah !== null, "an upcoming Havdalah is found from Friday noon");
  check(havdalah!.eventTime.getTime() > candle!.eventTime.getTime(), "Havdalah is after candle lighting");

  // Immediately after candle lighting, the SAME event must not still be
  // "upcoming" — the search has to actually respect "after now".
  const justAfter = new Date(candle!.eventTime.getTime() + 60_000);
  const nextCandle = upcomingCandleLighting(justAfter, CROWN_HEIGHTS);
  check(
    nextCandle !== null && nextCandle.eventTime.getTime() > candle!.eventTime.getTime(),
    "candle lighting search advances past an event once it's passed",
  );
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
