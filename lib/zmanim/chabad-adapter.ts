import "server-only";
import { parseZmanTime, zonedTimeToUtc } from "./time.ts";
import {
  CANONICAL_BY_ESSENTIAL_ZMAN_TYPE,
  providerNamespacedId,
  rollsIntoNextDay,
  type ChabadFootnote,
  type ChabadZman,
} from "./zman.ts";

/*
 * Chabad.org's Get_Zmanim endpoint, read into this project's own
 * `zmanim_cache.times` vocabulary — plan.md §5c.
 *
 * THIS IS THE LIVE READER AGAIN, and it now covers both halves of §5c's
 * Chabad support in ONE request: all thirteen daily zmanim AND candle
 * lighting, 92 days at a time. It supersedes both of the two surfaces
 * that were previously thought to be the only sanctioned options — the
 * published candle-lighting embed (chabad-embed.ts, four weeks, candle
 * lighting only, now kept unwired as a fallback) and the published zmanim
 * RSS feed (one day per request, no date parameter, so it could never
 * fill a cache at all).
 *
 * WHAT CHANGED, AND IT WAS THE REQUEST, NOT THE ENDPOINT. An earlier
 * 91-day call against this same endpoint returned 91 days and zero
 * candle-lighting times. The cause was four missing trailing parameters
 * (`before`, `after`, `ShabbosEnds`, `bdef`) plus a date format this code
 * had guessed at. With the full parameter set the endpoint returns 92
 * days — verified by hand, Sep 10 through Dec 10 2026 — carrying
 * `CandleLighting` on every Erev Shabbos and Yom Tov in the span.
 *
 * BOTH RESPONSE SHAPES ARE PARSED, AND THAT IS NOT DEFENSIVENESS. This
 * endpoint has been observed returning two different per-day shapes:
 *
 *   FLAT — `Days[].Zmanim[]`, entries keyed by `EssentialZmanType`, one
 *   per zman, no Hebrew anywhere. This is what a 92-day request with the
 *   full parameter set returned
 *   (test/fixtures/chabad-zmanim-33701-92day.json).
 *
 *   NESTED — `Days[].TimeGroups[].Items[]`, each group carrying `Title`,
 *   `EssentialTitle`, **`HebrewTitle`**, `OpinionInformation` and
 *   `TechnicalInformation` alongside its items. This is what a 4-day
 *   request returned (test/fixtures/chabad-zmanim-33710-nested-4day.json).
 *
 * WHICH PARAMETER SWITCHES BETWEEN THEM IS UNKNOWN, and it matters because
 * only the nested one carries Hebrew names. The two roots are structurally
 * identical — same sixteen keys, `IsAdvanced: false` in both — so the
 * difference is per-day, which rules out a whole-response "advanced" mode.
 * Two hypotheses, neither testable from this sandbox (the egress proxy
 * refuses CONNECT to chabad.org): one of the four trailing parameters,
 * `bdef` being the likeliest by name; or the RANGE LENGTH, since a 92-day
 * nested response would be enormous and an endpoint trimming to a lean
 * shape for long ranges is exactly what these two captures look like.
 * `scripts/probe-chabad-shape.ts` is what settles it.
 *
 * Parsing both is therefore not future-proofing — it is the only way the
 * Hebrew names arrive at all if the nested shape can be had, and the only
 * way the reader keeps working if the endpoint switches on us. The reader
 * prefers whichever the day actually carries.
 *
 * Structural facts measured off that capture, each of which a plausible
 * reading of the response would have got wrong:
 *
 * 1. `Tzeis` and `ShabbatEndTime` are MUTUALLY EXCLUSIVE. The 17 days
 *    carrying `ShabbatEndTime` are exactly the 17 with no `Tzeis`, so
 *    Chabad publishes one nightfall per day and relabels it rather than
 *    publishing two. Anything reading `Tzeis` unconditionally is blank on
 *    every Shabbos.
 * 2. `ShaahZmanit`'s `Zman` is "62:51 min." — a DURATION in MM:SS, on
 *    every day, in the same array as the clock times. Handed to
 *    `parseZmanTime` it reads as an hour of 62, which that function
 *    rejects; the row would have been silently dropped. See
 *    `parseShaahZmanit`.
 * 3. `ChatzosNight` reads "1:27 AM" and belongs to the night AFTER its
 *    row's date, so its instant is a day later than the row it is filed
 *    under — see `rollsIntoNextDay` in zman.ts for the DST measurement
 *    that proves it.
 * 4. `FootnoteType` is halachically meaningful. `LightCandlesAfter` on a
 *    `ShabbatEndTime` (9/12, 9/26, 10/3) is the second night of a two-day
 *    Yom Tov — candles lit after nightfall from an existing flame, which
 *    is emphatically NOT `candle_lighting`. The root `Footnotes` object
 *    holds each type's display text. Both are carried into the cache.
 * 5. `LocationId` comes back NULL even for a request that resolved
 *    correctly, so it cannot be the location check. `LocationName`
 *    ("Saint Petersburg, FL 33701") is what carries the answer — see
 *    `verifyLocationName`, which is load-bearing for the same reason it
 *    is in chabad-embed.ts.
 * 6. THE DISPLAY LABEL IS AT THE ROOT IN THE FLAT SHAPE. `Zmanim[]`
 *    entries carry no human-readable name at all — the response root's
 *    `GroupHeadings[]` holds one `EssentialTitle` per `EssentialZmanType`
 *    ("Latest Shacharit", "Earliest Tallit", "Shabbat Ends"), with `<br />`
 *    in it for the two-line column headers their own table renders. Those
 *    strings are cached onto each value (`ChabadClockZman.label`) so a
 *    board can show the provider's own words without this project keeping
 *    a label table of its own — see zman.ts.
 * 7. `item.Date` no longer exists on the entries at all, which retires
 *    the trap the previous shape had: there, every item within one day
 *    shared one `/Date(...)/` value regardless of its own time of day.
 *    The instant is still built the same three-part way — the DAY's own
 *    `DisplayDate`, the entry's own rendered `Zman`, and the org/screen's
 *    stored IANA timezone. Chabad's `LocationDetails` ("-5 GMT | DST in
 *    effect") is still deliberately not used for the offset: it is one
 *    fixed value for the whole response with no per-day breakdown, and a
 *    92-day span crosses a DST transition. The IANA zone knows its own
 *    rules for every day in the range; that string cannot.
 */

const ENDPOINT = "https://www.chabad.org/webservices/zmanim/zmanim/Get_Zmanim";

export type ChabadZmanimResult = {
  /** ISO date -> canonical zman id (or `chabad:<Type>` for the four §5c
   *  has no id for) -> value. One entry per day the response carried. */
  times: Record<string, Record<string, ChabadZman>>;
  /**
   * The untouched response, sliced one entry per day and keyed the same
   * way `times` is, for `zmanim_cache.raw_response`.
   *
   * PER-DAY, not the whole body on every row. At 92 days the body is
   * ~105KB; writing all of it onto each of 92 rows would be ~10MB per
   * location per warm, for one copy of the same bytes. Each slice
   * carries that day's own entry plus the response-level metadata a day
   * cannot be interpreted without (`LocationName`, `Footnotes`,
   * `LocationDetails`), which is a few hundred bytes.
   */
  rawResponseByDate: Record<string, unknown>;
  /** `LocationName`, already verified against the requested id. */
  location: string;
  /** The response's OWN `EndDate`, echoed back. Reported rather than
   *  trusted: the requested span and this are compared by the caller, so
   *  a silently coerced window shows up as a number instead of as a
   *  cache that is quietly short. */
  echoedEndDate: string | null;
  /** Every distinct `EssentialZmanType` seen, sorted — a changed
   *  vocabulary is then visible in one log line. */
  essentialZmanTypes: string[];
  /** Dates that carried a `CandleLighting`. WHICH days, not how many:
   *  candle lighting on every Friday is a working response, candle
   *  lighting on one day only is the signature of the bug this
   *  parameter set fixed. */
  candleLightingDates: string[];
  firstDate: string | null;
  lastDate: string | null;
  bytes: number;
};

/** "9/11/2026" -> {year, month, day}. The per-DAY calendar date, and the
 *  only date in the response that is per-day rather than
 *  response-wide. */
function parseDisplayDate(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  return { month: Number(match[1]), day: Number(match[2]), year: Number(match[3]) };
}

function isoDate(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/**
 * "62:51 min." -> 3771 seconds. MM:SS, not HH:MM — a shaah zmanis runs
 * roughly 45 to 75 minutes, and the fixture's own range is "52:44 min."
 * to "62:51 min.", both of which are impossible as hours.
 *
 * Returns null for anything that isn't this shape, so a `ShaahZmanit`
 * whose rendering changes fails the same way an unparseable clock time
 * does — skipped, with the raw day still cached — rather than becoming a
 * wrong number.
 */
function parseShaahZmanit(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,3}):(\d{2})\s*min\.?$/i.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[2]);
  if (seconds > 59) return null;
  return Number(match[1]) * 60 + seconds;
}

/**
 * `EssentialZmanType` -> the provider's own display label, from the
 * response root's `GroupHeadings[]`.
 *
 * `<br />` becomes a space: the tag is there because Chabad's own table
 * breaks "Latest\nShacharit" over two lines in a narrow column, which is
 * their layout decision and not part of the name. A board sets its own
 * wrapping.
 *
 * `GroupHeadings` also carries one entry with an empty `EssentialZmanType`
 * and the title "Parshah/Holiday" — a column of their table that is not a
 * zman at all. It is skipped by the empty-key test rather than by
 * name-matching, so a second such column would be skipped too.
 */
/**
 * One zman as read out of either per-day shape.
 *
 * `hebrewTitle` is per-day, not per-type, and that is a real finding rather
 * than caution: `ShabbatEndTime` came back as "הדלקת נרות" (candle
 * lighting) on 9/12, where the footnote is `LightCandlesAfter` and the time
 * is when to light on the second night of a two-day Yom Tov, and as "צאת
 * החג" (the festival ends) on 9/13. Chabad's Hebrew carries a halachic
 * distinction its own English `EssentialTitle` flattens to "Shabbat Ends"
 * in both. So it is cached on the value, not harvested once per type.
 */
type DayEntry = {
  type: string;
  zman: string;
  footnoteType: unknown;
  /** Only the nested shape has one. */
  hebrewTitle: string | null;
  /** The nested shape's own per-group English title, which the flat shape
   *  instead puts once at the root in `GroupHeadings`. */
  essentialTitle: string | null;
};

/** The item a group's value comes from.
 *
 *  `Default: true` marks it — but INCONSISTENTLY: in the captured nested
 *  response every group holds exactly one item and only nine of the
 *  fourteen carry the flag (netz, chatzos, candle lighting, shkia, chatzos
 *  halayla and shaah zmanit do not). So the flag is preferred and the first
 *  item is the fallback, rather than the flag being required. A group with
 *  several items and no flag would be the `IsAdvanced` view, which this
 *  never requests. */
function readGroupItem(items: unknown[]): Record<string, unknown> | null {
  const records = items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  return records.find((item) => item.Default === true) ?? records[0] ?? null;
}

/**
 * A day's zmanim, from whichever shape the day carries.
 *
 * Nested first: when a day has both (never observed, but the check has to
 * order them somehow) the nested one is strictly richer, since it is the
 * only one with Hebrew.
 */
function readDayEntries(day: Record<string, unknown>): DayEntry[] {
  const groups = Array.isArray(day.TimeGroups) ? (day.TimeGroups as unknown[]) : null;
  if (groups && groups.length > 0) {
    const entries: DayEntry[] = [];
    for (const rawGroup of groups) {
      const group = (rawGroup ?? {}) as Record<string, unknown>;
      const item = readGroupItem(Array.isArray(group.Items) ? (group.Items as unknown[]) : []);
      if (!item) continue;
      const type = group.EssentialZmanType ?? item.EssentialZmanType;
      if (typeof type !== "string" || type === "") continue;
      entries.push({
        type,
        zman: typeof item.Zman === "string" ? item.Zman : "",
        // The group's footnote, not the item's: that is where the nested
        // shape puts it, and it is what the flat shape moved onto the entry.
        footnoteType: group.FootnoteType ?? item.FootnoteType,
        hebrewTitle: typeof group.HebrewTitle === "string" ? group.HebrewTitle : null,
        essentialTitle: typeof group.EssentialTitle === "string" ? group.EssentialTitle : null,
      });
    }
    return entries;
  }

  const flat = Array.isArray(day.Zmanim) ? (day.Zmanim as unknown[]) : [];
  const entries: DayEntry[] = [];
  for (const rawEntry of flat) {
    const entry = (rawEntry ?? {}) as Record<string, unknown>;
    const type = entry.EssentialZmanType;
    if (typeof type !== "string" || type === "") continue;
    entries.push({
      type,
      zman: typeof entry.Zman === "string" ? entry.Zman : "",
      footnoteType: entry.FootnoteType,
      hebrewTitle: null,
      essentialTitle: null,
    });
  }
  return entries;
}

function readLabels(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const rawHeading of Array.isArray(value) ? (value as unknown[]) : []) {
    const heading = (rawHeading ?? {}) as Record<string, unknown>;
    const type = heading.EssentialZmanType;
    const title = heading.EssentialTitle;
    if (typeof type !== "string" || type === "") continue;
    if (typeof title !== "string" || title.trim() === "") continue;
    labels[type] = flattenTitle(title);
  }
  return labels;
}

/** `<br />` becomes a space and runs of whitespace collapse. Chabad breaks
 *  "Latest\nShacharit" over two lines for its own narrow columns, which is
 *  their layout decision and not part of the name; a board sets its own
 *  wrapping. Shared by the root headings and the nested groups' own
 *  titles, English and Hebrew alike. */
function flattenTitle(title: string): string {
  return title
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/[\s ]+/g, " ")
    .trim();
}

/** `FootnoteType` plus the root `Footnotes` text for it. "None" is
 *  Chabad's own no-footnote value and is not one. */
function readFootnote(value: unknown, footnotes: Record<string, unknown>): ChabadFootnote | undefined {
  if (typeof value !== "string" || value === "" || value === "None") return undefined;
  const text = footnotes[value];
  return { type: value, text: typeof text === "string" ? text : null };
}

/*
 * LOWERCASE PARAMETER NAMES, EXCEPT `ShabbosEnds`. DO NOT "NORMALIZE"
 * EITHER DIRECTION.
 *
 * Chabad's query parameter names are case-sensitive and the failure mode
 * is silent: `locationid` and `locationtype` work, while `locationId` and
 * `locationType` are ignored and the endpoint falls back to a default
 * location — Brooklyn — returning a completely normal-looking response
 * for the wrong city with no error at all. Verified by hand: same ZIP,
 * same URL, only capitalization differing, returned Saint Petersburg vs.
 * Brooklyn.
 *
 * `ShabbosEnds` is genuinely mixed-case in the hand-verified working
 * request, and lowercasing it for consistency is exactly as unsafe as
 * camelCasing the other two — the verified URL is the contract here, not
 * a naming convention. The whole parameter list below is spelled the way
 * the request that was proven to work spells it.
 *
 * What makes this a live trap rather than a curiosity: every other
 * identifier in this codebase is camelCase, and the candle-lighting
 * embed's own response markup links to `?locationId=...&locationType=2`,
 * so the provider appears to endorse the spelling that breaks the
 * request. `verifyLocationName` below is the compensating control, which
 * is why that check is load-bearing rather than defensive.
 *
 * THE DATE FORMATS DIFFER ON PURPOSE AND ARE NOT A TYPO. `tdate` is
 * M-D-YYYY with hyphens; `startdate` and `enddate` are M/D/YYYY with
 * slashes, which `URLSearchParams` percent-encodes to `%2F`. Both were
 * verified by hand in that combination. This is the single most
 * "tidy-able" thing in this file and the previous version of this code
 * sent ISO for all three, which is how a call came back with zero candle
 * lighting.
 */
function chabadDate(iso: string, separator: "-" | "/"): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${month}${separator}${day}${separator}${year}`;
}

function zmanimUrl(input: { locationId: string; locationType: "1" | "2"; startDate: string; endDate: string }): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("locationid", input.locationId);
  url.searchParams.set("locationtype", input.locationType);
  url.searchParams.set("save", "1");
  url.searchParams.set("tdate", chabadDate(input.startDate, "-"));
  url.searchParams.set("jewish", "Zmanim-Halachic-Times.htm");
  url.searchParams.set("startdate", chabadDate(input.startDate, "/"));
  url.searchParams.set("enddate", chabadDate(input.endDate, "/"));
  // `before` is candle-lighting minutes before sunset, and it takes
  // effect: measured at exactly -18 minutes from `Shkiah` on all 14
  // candle-lighting days in the fixture, and echoed back in
  // `LocationDetails` ("Candle Lighting is 18 mins. before sunset"). 18 is
  // Chabad's own Diaspora default and the same number @hebcal/core uses
  // (lib/hebrew/candle-times.ts), so nothing diverges by hardcoding it —
  // and making it a setting later is a one-parameter change.
  url.searchParams.set("before", "18");
  // `after` is passed exactly as verified, and its effect is NOT visible
  // in the response: `ShabbatEndTime` comes back 34–38 minutes after
  // sunset, tracking 8.5° tzeis rather than a fixed 42. So this is not a
  // Shabbos-end offset knob despite reading like one. Sent verbatim
  // because the verified request sends it; not reinterpreted, and not
  // dropped on a guess that it is inert.
  url.searchParams.set("after", "42");
  url.searchParams.set("ShabbosEnds", "1");
  url.searchParams.set("bdef", "0");
  // Deliberately no `aid` parameter — confirmed by hand not to be required.
  return url;
}

/**
 * The requested location has to appear in the `LocationName` the response
 * returns, or the whole response is refused and nothing is cached.
 *
 * This is the case-sensitivity control above, so it is not optional and
 * not a warning: a wrong-location response is byte-for-byte normal apart
 * from this one string. A refusal sends the widget down §5c's Hebcal
 * fallback, which computes the right city's times from the org's own
 * coordinates — strictly better than caching another city's.
 *
 * ENFORCEABLE FOR BOTH KINDS OF ID NOW. A ZIP is checked against the
 * response's own name, which contains it. A city id is checked against the
 * Title `Get_Locations` returned for it, stored alongside the id
 * (`orgs.zmanim_location_name`) precisely so there is something to compare
 * — that used to be the gap that made `locationtype=1` unusable rather
 * than merely unsupported. The one case still unverifiable is a city id
 * stored before the search existed, which is logged rather than refused.
 */
function verifyLocationName(
  body: Record<string, unknown>,
  input: { locationId: string; locationType: "1" | "2"; expectedName?: string | null },
): string {
  const location = typeof body.LocationName === "string" ? body.LocationName.trim() : "";
  if (!location) throw new Error("Chabad zmanim: no LocationName in the response");

  if (input.locationType === "2") {
    if (!location.includes(input.locationId)) {
      throw new Error(
        `Chabad zmanim: asked for ZIP ${input.locationId} but the response is for "${location}" — ` +
          "refusing it rather than caching another city's times (see this module's note on parameter case)",
      );
    }
    return location;
  }

  /*
   * A CITY ID, WHICH USED TO BE UNVERIFIABLE. The gap was real and logged:
   * a `locationtype=1` response carries no id to match, `LocationId` comes
   * back null, and "Brooklyn, NY" is a perfectly normal-looking answer to
   * a request that was supposed to be Lugano. So the compensating control
   * that makes the ZIP path safe simply did not exist for a city, and the
   * settings form said so where the field would have gone.
   *
   * `Get_Locations` closes it: the search returns the Title for the id it
   * gives us, that Title is stored (`orgs.zmanim_location_name`), and it is
   * what the response's own `LocationName` is checked against.
   */
  const expected = normalizeName(input.expectedName ?? "");
  if (!expected) {
    /*
     * Nothing to check against — an id stored before the search existed,
     * dug out of a chabad.org URL by hand. Logged loudly rather than
     * refused: that configuration worked (unverified) before this check,
     * and blanking a shul's board to enforce a check it predates would be
     * this change breaking something it was meant to protect. The log names
     * the city actually served, so a wrong id is at least discoverable
     * after the fact, and re-picking the location in settings stores a name
     * and closes it properly.
     */
    console.error(
      `[chabad-zmanim] locationtype=1 id ${input.locationId} has no stored name to verify — ` +
        `served "${location}", cached unverified. Re-pick this shul's location in settings to fix.`,
    );
    return location;
  }

  /*
   * THE CITY TOKEN, NOT THE WHOLE TITLE, and this is a deliberate looseness
   * rather than a sloppy compare. Nobody has yet seen a `LocationName` from
   * a `locationtype=1` request — the search's Title is "Lugano,
   * Switzerland", and whether the zmanim response says exactly that, or
   * "Lugano TI, Switzerland", or names a canton, is unobserved. Requiring
   * the whole string to match would refuse every international shul the
   * first time the two surfaces format a region differently.
   *
   * So this asserts what the failure mode actually needs: the place before
   * the first comma has to appear in what came back. Brooklyn served for
   * Lugano fails it; "Lugano TI" served for Lugano passes. It is the same
   * shape as the ZIP check one line up — a substring of the response's own
   * name — which is why the two read alike.
   */
  const expectedCity = expected.split(",")[0].trim();
  if (!expectedCity || !normalizeName(location).includes(expectedCity)) {
    throw new Error(
      `Chabad zmanim: asked for "${input.expectedName}" (locationid ${input.locationId}) but the ` +
        `response is for "${location}" — refusing it rather than caching another city's times`,
    );
  }
  return location;
}

/** Case- and whitespace-insensitive, for comparing two surfaces' spellings
 *  of one place. `Get_Locations` returns "Lugano,  Switzerland" with two
 *  spaces after the comma, and chabad.org uses non-breaking spaces
 *  liberally, so an exact compare would fail on formatting alone. */
function normalizeName(value: string): string {
  return value.replace(/[\s ]+/g, " ").trim().toLowerCase();
}

/**
 * One line per request, at `console.info` so it lands in Vercel's
 * function logs without a log-level flag.
 *
 * Every field answers a question a count alone cannot. The full URL, so a
 * wrong date format or a missing parameter is visible rather than
 * inferred. Status and byte length, which separate a truncated body from
 * a full one. `days` plus the first and last `DisplayDate` AND the
 * response's own `EndDate`, which is what says whether chabad.org
 * honoured the range it was asked for or substituted its own. Every
 * distinct `EssentialZmanType`, so a changed vocabulary is obvious. And
 * the dates that carried a `CandleLighting`, because which days is the
 * discriminating fact.
 *
 * Deliberately not logged: the response body. It is ~105KB at 92 days,
 * it is already in `zmanim_cache.raw_response` where it can be read at
 * leisure, and a log line nobody can scroll through is not a diagnostic.
 */
function logRequest(url: URL, status: number, result: ChabadZmanimResult, days: number): void {
  console.info(
    "[chabad-zmanim] " +
      JSON.stringify({
        url: url.toString(),
        status,
        bytes: result.bytes,
        days,
        firstDate: result.firstDate,
        lastDate: result.lastDate,
        echoedLocation: result.location,
        echoedEndDate: result.echoedEndDate,
        essentialZmanTypes: result.essentialZmanTypes,
        candleLightingDates: result.candleLightingDates,
      }),
  );
}

/**
 * One (chabad, location) pair's zmanim for the given date range, ready to
 * upsert into `zmanim_cache` one row per date.
 *
 * `startDate` and `endDate` are ISO `YYYY-MM-DD` — this project's own date
 * vocabulary. Chabad's two incompatible date formats are built inside
 * `zmanimUrl`, where the comment explaining them lives, so no caller has
 * to know about them.
 *
 * `timeZone` is the org/screen's own stored IANA zone, used to turn each
 * entry's rendered clock time into an instant. `display` is Chabad's own
 * string verbatim, never re-rendered — plan.md §5c's "never re-round or
 * recompute provider output." (The previous version of this file
 * re-rendered through `Intl` because the older, nested shape was thought
 * not to expose the string; it does, in `Zman`.)
 */
export async function fetchChabadZmanim(input: {
  locationId: string;
  locationType: "1" | "2";
  /** The place this id is supposed to be — `ChabadLocation.expectedName`.
   *  Required in practice for `locationType: "1"`; see
   *  `verifyLocationName`, which refuses a mismatch and logs loudly when
   *  there is nothing to compare. */
  expectedName?: string | null;
  startDate: string;
  endDate: string;
  timeZone: string;
}): Promise<ChabadZmanimResult> {
  const url = zmanimUrl(input);

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    console.error(`[chabad-zmanim] ${response.status} ${response.statusText} for ${url.toString()}`);
    throw new Error(`Chabad zmanim request failed: ${response.status} ${response.statusText}`);
  }

  // Read as text, not `.json()`: the byte length is part of what the log
  // has to report, and a body that isn't JSON at all becomes a
  // diagnosable error with a snippet rather than an opaque throw.
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(
      `[chabad-zmanim] 200 but unparseable body, ${raw.length} bytes, for ${url.toString()} — starts: ${JSON.stringify(raw.slice(0, 200))}`,
    );
    throw new Error("Chabad zmanim response was not JSON");
  }

  const body = (parsed ?? {}) as Record<string, unknown>;

  // Before any parsing. A response for the wrong city parses perfectly.
  const location = verifyLocationName(body, input);

  const footnotes = (body.Footnotes ?? {}) as Record<string, unknown>;
  const labels = readLabels(body.GroupHeadings);
  const days = Array.isArray(body.Days) ? (body.Days as unknown[]) : [];

  const times: Record<string, Record<string, ChabadZman>> = {};
  const rawResponseByDate: Record<string, unknown> = {};
  const dates: string[] = [];
  const essentialZmanTypes = new Set<string>();
  const candleLightingDates: string[] = [];

  for (const rawDay of days) {
    const day = (rawDay ?? {}) as Record<string, unknown>;
    const calendarDate = parseDisplayDate(day.DisplayDate);
    if (!calendarDate) continue;
    const date = isoDate(calendarDate);
    dates.push(date);

    // Per-day slice plus the response-level fields a day cannot be read
    // without — see `rawResponseByDate`'s own note on why not the whole
    // body 92 times.
    rawResponseByDate[date] = {
      Day: day,
      LocationName: body.LocationName ?? null,
      LocationDetails: body.LocationDetails ?? null,
      Footnotes: body.Footnotes ?? null,
      GroupHeadings: body.GroupHeadings ?? null,
      EndDate: body.EndDate ?? null,
    };

    for (const entry of readDayEntries(day)) {
      const type = entry.type;
      essentialZmanTypes.add(type);

      const footnote = readFootnote(entry.footnoteType, footnotes);
      // The root's `GroupHeadings` when the flat shape is in play; the
      // group's own title when the nested one is, since that shape carries
      // it per day and there may be no root heading for a type.
      const label = labels[type] ?? (entry.essentialTitle ? flattenTitle(entry.essentialTitle) : undefined);
      const hebrewLabel = entry.hebrewTitle ? flattenTitle(entry.hebrewTitle) : undefined;
      const display = entry.zman.replace(/\s+/g, " ").trim();
      // Exact match on the canonical table, then the provider-namespaced
      // key for the four §5c has no id for. Nothing is dropped for want
      // of a mapping, and nothing gets a canonical id it hasn't earned —
      // see zman.ts.
      const id = CANONICAL_BY_ESSENTIAL_ZMAN_TYPE[type] ?? providerNamespacedId(type);

      const durationSeconds = parseShaahZmanit(display);
      if (durationSeconds !== null) {
        times[date] ??= {};
        times[date][id] = {
          durationSeconds,
          display,
          ...(footnote ? { footnote } : {}),
          ...(label ? { label } : {}),
          ...(hebrewLabel ? { hebrewLabel } : {}),
        };
        continue;
      }

      const clock = parseZmanTime(display);
      if (!clock) continue;

      // The row's own date, except for the one type whose clock time
      // belongs to the following night — zman.ts's `rollsIntoNextDay`.
      // Only the instant moves; the value stays keyed under this row's
      // date, which is where Chabad prints it.
      const shift = rollsIntoNextDay(type, clock.hour) ? 1 : 0;
      const anchor = new Date(Date.UTC(calendarDate.year, calendarDate.month - 1, calendarDate.day + shift));
      const instant = zonedTimeToUtc(
        anchor.getUTCFullYear(),
        anchor.getUTCMonth() + 1,
        anchor.getUTCDate(),
        clock.hour,
        clock.minute,
        input.timeZone,
      );

      times[date] ??= {};
      times[date][id] = {
        iso: instant.toISOString(),
        display,
        ...(footnote ? { footnote } : {}),
        ...(label ? { label } : {}),
        ...(hebrewLabel ? { hebrewLabel } : {}),
      };
      if (type === "CandleLighting") candleLightingDates.push(date);
    }
  }

  const result: ChabadZmanimResult = {
    times,
    rawResponseByDate,
    location,
    echoedEndDate: typeof body.EndDate === "string" ? body.EndDate : null,
    essentialZmanTypes: [...essentialZmanTypes].sort(),
    candleLightingDates,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    bytes: raw.length,
  };

  logRequest(url, response.status, result, days.length);
  return result;
}
