import "server-only";
import { parseZmanTime, zonedTimeToUtc } from "./time.ts";

/*
 * Chabad.org's PUBLISHED candle-lighting embed — the source Chabad.org
 * pointed at directly when asked, in place of the undocumented
 * Get_Zmanim JSON endpoint. plan.md §10.4's open question is closed by
 * that answer: this is a supported, public integration surface with an
 * attribution condition, not something read without permission.
 *
 * The unwired `chabad-adapter.ts` is the old JSON reader. It is kept
 * because it is still the only source for zmanim BEYOND candle lighting,
 * which is a separate unresolved conversation (plan.md §5c).
 *
 * WHAT THE RESPONSE ACTUALLY IS — confirmed against a real capture, not a
 * description. test/fixtures/chabad-embed-33701-4w.js is the verbatim body
 * for ZIP 33701 at weeks=4. It is a JavaScript file consisting of exactly
 * one `document.write('<table ...>')` call: one line, no literal newlines,
 * no backslash escapes, and the HTML inside uses double quotes throughout
 * so the single-quoted JS string needs no unescaping. Every structural
 * claim below comes from that file.
 *
 * FOUR THINGS THE CAPTURE CORRECTED, each of which a reasonable reading of
 * the markup would have got wrong:
 *
 * 1. `weeks=4` DOES NOT MEAN FOUR ENTRIES. It returned 13, spanning 24
 *    days (Fri 9/11 to Sun 10/4) — four Fridays plus each one's Shabbat
 *    plus the extra holiday-ending days around Rosh Hashanah, Yom Kippur
 *    and Sukkot. So `weeks` is weeks of coverage, and a 90-day cache
 *    window needs `weeks=13`.
 *
 * 2. THE WEEKDAY IS SOMETIMES "Shabbat", NOT "Saturday" — "Shabbat,
 *    September 12, 2026". V8's `Date.parse` happens to tolerate the
 *    unrecognised word and return the right day, but that is engine
 *    leniency for a non-standard format, not a contract. The date is
 *    therefore parsed field by field, month name looked up explicitly,
 *    and never handed to `Date.parse`.
 *
 * 3. THE TIME IS SEPARATED BY `&nbsp;`, not a space: "Light Shabbat /
 *    Holiday Candles at&nbsp;7:22 PM". Splitting on whitespace finds one
 *    token.
 *
 * 4. THERE ARE MORE THAN THREE PHRASINGS. The capture carries five:
 *    "Light Shabbat / Holiday Candles at", "Light Candles at", "Light
 *    Holiday Candles at" (Erev Yom Kippur, a Sunday), "Light Holiday
 *    Candles after", and both "Shabbat Ends" and "Holiday Ends". So
 *    matching is by phrase FAMILY — lights-at, lights-after, ends — not
 *    by a list of literal strings, and an unrecognised phrase throws
 *    rather than being dropped.
 */

/** Canonical zman ids this reader produces — plan.md §5c's own spelling.
 *  `shabbos_ends` is parsed and cached even though no widget reads it yet:
 *  it is in the response, it is a canonical id, and dropping data the
 *  provider already sent would mean re-fetching to get it later. */
export type ChabadEmbedZman = { iso: string; display: string };

export type ChabadEmbedResult = {
  /** ISO date -> canonical zman id -> value. Only dates that produced at
   *  least one value appear. */
  times: Record<string, Record<string, ChabadEmbedZman>>;
  /** The heading's own location text, e.g. "Saint Petersburg, FL 33701" —
   *  verified against the requested ZIP before this is returned at all. */
  location: string;
  /** The verbatim response body, for `zmanim_cache.raw_response`. A
   *  published surface can still be restyled, and this is the only way to
   *  tell why a parse started coming back thin. */
  raw: string;
  entries: number;
  firstDate: string | null;
  lastDate: string | null;
};

const ENDPOINT = "https://www.chabad.org/tools/shared/candlelighting/candlelighting.js.asp";

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Unwraps the single `document.write('...')` call.
 *
 * Deliberately not a regex over the whole body: the HTML inside contains
 * `)` and `'` sequences that a lazy match would stop at. The prefix is
 * fixed and the call is the last thing in the file, so this takes the
 * first `('` and the last `')`. `\'` is unescaped anyway — the capture has
 * none, but a holiday name with an apostrophe is a matter of Chabad's
 * copy, not of their markup, so it costs nothing to survive one.
 */
function unwrapDocumentWrite(body: string): string {
  const open = body.indexOf("document.write('");
  if (open === -1) throw new Error("Chabad embed: no document.write( in the response");
  const start = open + "document.write('".length;
  const close = body.lastIndexOf("')");
  if (close <= start) throw new Error("Chabad embed: unterminated document.write(");
  return body.slice(start, close).replace(/\\'/g, "'");
}

/** Tags out, entities that actually appear in, whitespace collapsed. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Friday, September 11, 2026" or "Shabbat, September 12, 2026" ->
 * "2026-09-11". The weekday word is dropped without being validated —
 * see this file's header on why "Shabbat" appears where "Saturday" would
 * and why `Date.parse` is not used.
 */
function parseEntryDate(value: string): string | null {
  const match = /^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(value.trim());
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase()) + 1;
  if (month === 0) return null;
  const day = Number(match[2]);
  if (day < 1 || day > 31) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type Phrasing =
  | { kind: "candle_lighting" }
  | { kind: "shabbos_ends" }
  /** The second night of a two-day Yom Tov: candles are lit from an
   *  existing flame after nightfall, not before sunset. Known and
   *  deliberately excluded, exactly as the JSON adapter excluded its
   *  `ShabbatEndTime`/`LightCandlesAfter` equivalent. Not an error — a
   *  real, expected entry this reader does not yet represent. */
  | { kind: "lights-after-nightfall" };

/**
 * Classifies by phrase family, and returns null for anything unrecognised
 * so the caller can throw. Fails loudly on purpose: a phrasing nobody has
 * seen is either a new halachic case or a copy change, and silently
 * dropping it would put a shul's board a week behind with nothing
 * anywhere saying why.
 */
function classify(phrase: string): Phrasing | null {
  const normalised = phrase.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^light\b.*\bcandles after$/.test(normalised)) return { kind: "lights-after-nightfall" };
  if (/^light\b.*\bcandles at$/.test(normalised)) return { kind: "candle_lighting" };
  if (/^(shabbat|shabbos|holiday|yom tov)\b.*\bends$/.test(normalised)) return { kind: "shabbos_ends" };
  return null;
}

/*
 * LOWERCASE PARAMETER NAMES. DO NOT CAMELCASE THESE.
 *
 * Chabad's query parameter names are case-sensitive, and the failure mode
 * is silent: `locationid` and `locationtype` work, while `locationId` and
 * `locationType` are ignored and the endpoint falls back to a default
 * location — Brooklyn — returning a completely normal-looking response for
 * the wrong city, with no error. Verified by hand: same ZIP, same URL,
 * only capitalization differing, returned Saint Petersburg vs. Brooklyn.
 *
 * What makes this a live trap rather than a curiosity: the response's OWN
 * heading link is camelCase — `candlelighting.asp?locationId=33701&
 * locationType=2` is in the captured fixture — so the provider's markup
 * appears to endorse the spelling that breaks the request. Add that to
 * every other identifier in this codebase being camelCase, and a
 * consistency pass "fixing" these two is close to inevitable. The
 * consequence is a shul's lobby screen showing Brooklyn's candle lighting,
 * which nothing in the product would flag as wrong.
 *
 * `verifyLocation` below is the compensating control, and it is the reason
 * that check is load-bearing rather than defensive.
 */
function embedUrl(locationId: string, weeks: number): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("locationid", locationId);
  url.searchParams.set("locationtype", "2");
  url.searchParams.set("ln", "2");
  url.searchParams.set("weeks", String(weeks));
  return url;
}

/**
 * The requested ZIP has to appear in the heading the response returns, or
 * the whole response is refused and nothing is cached.
 *
 * This is the case-sensitivity control above, so it is not optional and
 * not a warning: a wrong-location response is byte-for-byte normal apart
 * from this one string, so there is no second signal to fall back on. A
 * refusal sends the widget down §5c's Hebcal fallback, which computes the
 * right city's times from the org's own coordinates — strictly better than
 * caching another city's.
 */
function verifyLocation(inner: string, locationId: string): string {
  const heading = /class="CLheading"[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(inner);
  const location = heading ? text(heading[1]).replace(/^Shabbat Times for:\s*/i, "") : "";
  if (!location) throw new Error("Chabad embed: no location heading in the response");
  if (!location.includes(locationId)) {
    throw new Error(
      `Chabad embed: asked for ${locationId} but the response is for "${location}" — ` +
        "refusing it rather than caching another city's times (see this module's note on parameter case)",
    );
  }
  return location;
}

/**
 * One location's candle lighting and Shabbos-end times from the published
 * embed.
 *
 * `weeks` is the embed's own unit of coverage, not a day count — see this
 * file's header. The caller asks for what its cache window needs and
 * caches whatever comes back; nothing here assumes the request was
 * honoured in full, and the span is reported so a cap shows up in the log
 * rather than as a quietly short cache.
 */
export async function fetchChabadEmbed(input: {
  locationId: string;
  weeks: number;
  timeZone: string;
}): Promise<ChabadEmbedResult> {
  const url = embedUrl(input.locationId, input.weeks);
  const response = await fetch(url, { headers: { Accept: "*/*" } });
  if (!response.ok) {
    throw new Error(`Chabad embed request failed: ${response.status} ${response.statusText}`);
  }

  const raw = await response.text();
  const inner = unwrapDocumentWrite(raw);
  const location = verifyLocation(inner, input.locationId);

  const times: Record<string, Record<string, ChabadEmbedZman>> = {};
  const dates: string[] = [];

  const pairs = inner.matchAll(
    /<div class="CLdate">([\s\S]*?)<\/div>\s*<div class="CLTime">([\s\S]*?)<\/div>/gi,
  );

  for (const [, dateHtml, timeHtml] of pairs) {
    // The .CLdate div carries the date and, optionally, a holiday name in a
    // nested span ("- Eve of First day Rosh Hashanah"). `text()` flattens
    // both; parseEntryDate reads only the leading date and ignores the rest.
    const isoDate = parseEntryDate(text(dateHtml));
    if (!isoDate) throw new Error(`Chabad embed: unparseable date "${text(dateHtml)}"`);
    dates.push(isoDate);

    const line = text(timeHtml);
    const split = /^(.*?)\s*(\d{1,2}:\d{2}\s*(?:AM|PM))$/i.exec(line);
    if (!split) throw new Error(`Chabad embed: no time found in "${line}" on ${isoDate}`);

    const phrasing = classify(split[1]);
    if (!phrasing) {
      // Loudly, per this module's contract. An unrecognised phrasing means
      // the response changed or a halachic case appeared that this reader
      // does not represent; either way a human has to look.
      throw new Error(`Chabad embed: unrecognised phrasing "${split[1]}" on ${isoDate}`);
    }
    if (phrasing.kind === "lights-after-nightfall") continue;

    const clock = parseZmanTime(split[2]);
    if (!clock) throw new Error(`Chabad embed: unparseable time "${split[2]}" on ${isoDate}`);

    const [year, month, day] = isoDate.split("-").map(Number);
    const instant = zonedTimeToUtc(year, month, day, clock.hour, clock.minute, input.timeZone);

    times[isoDate] ??= {};
    times[isoDate][phrasing.kind] = {
      iso: instant.toISOString(),
      // Chabad's own rendered string, verbatim — plan.md §5c's "never
      // re-round or recompute provider output". Unlike the JSON endpoint,
      // this surface gives us the display string directly, so there is no
      // reason to re-render it.
      display: split[2].replace(/\s+/g, " ").trim(),
    };
  }

  return {
    times,
    location,
    raw,
    entries: dates.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}
