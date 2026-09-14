import "server-only";
import { parseZmanTime, zonedTimeToUtc } from "./time.ts";
import { providerNamespacedId, type ChabadZman } from "./zman.ts";

/*
 * Chabad.org's published zmanim RSS feed, read into this project's own
 * `zmanim_cache.times` vocabulary — plan.md §5c.
 *
 * THIS IS THE LIVE READER. It replaced the Get_Zmanim JSON adapter
 * (chabad-adapter.ts, now kept unwired) for two reasons that matter more than
 * the one thing it gives up:
 *
 *  - IT CARRIES THE HEBREW ZMAN NAMES SPELLED IN LATIN. Every item's title is
 *    "English (Transliteration)" — "Dawn (Alot Hashachar)", "Sunset
 *    (Shkiah)" — so the widget can show a row as either "Dawn" or "Alot
 *    Hashachar" from the provider's own words, with no house table. Get_Zmanim
 *    only ever returned English in the shape a long request came back in.
 *  - IT IS A PUBLISHED, DOCUMENTED FEED. Get_Zmanim is undocumented and needs
 *    four case-sensitive trailing parameters that fail silently; this is a
 *    plain `?locationId=<zip>&locationType=2` URL.
 *
 * WHAT IT GIVES UP: RANGE. The feed returns ONE DAY — today for the ZIP, no
 * date parameter (docs/plan.md §5c said as much). So the warm fetches today
 * only (lib/zmanim/warm.ts), and a screen that goes offline for more than a
 * day shows the zmanim widget's unavailable state for the new date until it
 * reconnects. That is the accepted trade for US-only-for-now; the day
 * Get_Zmanim's 92-day range or non-US city ids are wanted again, that adapter
 * is the reader to re-wire.
 *
 * US ONLY. The feed is fetched by `locationType=2`, a literal US ZIP
 * (lib/zmanim/location.ts). Non-US city ids (`locationtype=1`) are not read
 * through here.
 *
 * THE PARAMETER NAMES ARE camelCase HERE, unlike Get_Zmanim's lowercase ones.
 * The feed's own URL is `?locationId=...&locationType=...`; that is the
 * contract, verified against the sample feed, and not to be "normalised" to
 * match the other endpoint.
 */

const ENDPOINT = "https://www.chabad.org/tools/rss/zmanim.xml";

export type ChabadRssResult = {
  /** ISO date -> canonical zman id (or `chabad:<Type>`) -> value. The feed is
   *  one day, so this holds exactly one date's entry. */
  times: Record<string, Record<string, ChabadZman>>;
  /** The untouched feed, keyed by the one date it carried, for
   *  `zmanim_cache.raw_response`. One day of RSS is a couple of kilobytes, so
   *  the whole body is kept rather than sliced. */
  rawResponseByDate: Record<string, unknown>;
  /** The place the channel title names ("Saint Petersburg, FL 33710"),
   *  already verified to contain the requested ZIP. */
  location: string;
  /** The one date the feed carried, `YYYY-MM-DD`, or null. */
  date: string | null;
  /** Canonical zman ids written, sorted — a mapping regression is then
   *  visible in one log line. */
  zmanIds: string[];
  /** Whether the day carried a candle-lighting item. */
  hasCandleLighting: boolean;
  bytes: number;
};

/**
 * Feed item name (English, possibly with a transliteration in parentheses and
 * a footnote after `|`) -> canonical zman id.
 *
 * KEYED ON DISTINCTIVE TOKENS, not exact names, because the feed's wording is
 * not perfectly regular — "Mincha Ketanah (Small Mincha)" puts the English
 * gloss in the parentheses where every other row puts the transliteration,
 * and "Latest Shema" has no parentheses at all. Matching a distinctive token
 * from each name survives those quirks and small rewordings; the order below
 * matters only where one token could appear in two names, and each pair that
 * could (the three minchas, midday vs midnight) is separated by a token that
 * appears in exactly one.
 *
 * The ids are the same canonical vocabulary Get_Zmanim mapped to
 * (lib/zmanim/zman.ts) — Chabad publishes the Baal HaTanya shitah either way,
 * so alos/shema/tfila/tzeis carry the `_baal_hatanya` ids, and the
 * shitah-neutral ones (netz, shkia, chatzos, …) carry the plain ones.
 */
const RSS_CANONICAL: readonly [RegExp, string][] = [
  [/alot|alos|dawn/i, "alos_baal_hatanya"],
  [/misheyakir|tallit and tefillin|earliest tallit/i, "misheyakir"],
  [/sunrise|hanetz|\bnetz\b/i, "netz"],
  [/latest shema|\bshema\b/i, "sof_zman_shma_baal_hatanya"],
  [/latest shacharit|shacharit/i, "sof_zman_tfila_baal_hatanya"],
  [/mincha gedolah|earliest mincha/i, "mincha_gedola"],
  [/mincha ketanah|small mincha/i, "mincha_ketana"],
  [/plag/i, "plag_hamincha"],
  // Midnight before midday is not required (the tokens differ), but keeping
  // the two nightfall-adjacent names adjacent reads clearer.
  [/midnight|chatzot ha[- ]?lailah|chatzos ha[- ]?lailah/i, "chatzos_laila"],
  [/midday|chatzot hayom|chatzos hayom/i, "chatzos"],
  [/sunset|shkiah|shkia/i, "shkia"],
  [/nightfall|tzeit|tzeis/i, "tzeis_baal_hatanya"],
  [/candle[- ]?lighting/i, "candle_lighting"],
  [/shabbat ends|shabbos ends|havdalah/i, "shabbos_ends"],
];

/** `ShaahZmanit` is a DURATION ("62:18 min."), matched separately so it maps
 *  to the same provider-namespaced key the JSON adapter used and never
 *  collides with a clock zman. Not offered in the widget (zman.ts's
 *  CHABAD_SUPPLIES), cached rather than dropped. */
const SHAAH = /shaah zmanit|proportional hour/i;

/** The one type whose clock time belongs to the night AFTER its date, so its
 *  instant is built one civil day later — zman.ts's `rollsIntoNextDay`, by
 *  canonical id here since the feed carries no `EssentialZmanType`. The
 *  before-noon test is the rule, not a guard: chatzos halayla can fall just
 *  before local midnight near a zone's eastern edge. */
function rollsIntoNextDay(canonicalId: string, hour: number): boolean {
  return canonicalId === "chatzos_laila" && hour < 12;
}

/** Maps one feed item name to a canonical id, or a namespaced fallback for a
 *  name the table doesn't recognise — retained rather than dropped so a
 *  changed feed vocabulary is visible in the cache and the logs, never a
 *  silent gap. */
function canonicalIdFor(name: string): string {
  if (SHAAH.test(name)) return providerNamespacedId("ShaahZmanit");
  for (const [pattern, id] of RSS_CANONICAL) {
    if (pattern.test(name)) return id;
  }
  return providerNamespacedId(pascalCase(name));
}

/** "Some New Zman" -> "SomeNewZman", for an unrecognised item's fallback key.
 *  Only reached if the feed adds a name this project has never seen. */
function pascalCase(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") || "Unknown";
}

/** The handful of XML entities this feed actually uses. Not a general XML
 *  parser — the feed is a fixed, simple shape and a full parser is a
 *  dependency this doesn't need. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&");
}

/** First `<tag>…</tag>` inside `source`, decoded and trimmed, or null. */
function tag(source: string, name: string): string | null {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(source);
  return match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : null;
}

/** "September 14, 2026" or an item title's "(9/14/2026)" -> "YYYY-MM-DD". */
function parseMdY(match: RegExpMatchArray | null): string | null {
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !day || !year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * One item's name (no time, no date), split into the English label, the
 * transliteration (the parenthetical, when it is one), and the footnote
 * (after `|`).
 *
 * IMPERFECT BY THE FEED'S OWN INCONSISTENCY, accepted. Most rows are
 * "English (Transliteration)"; a few ("Mincha Ketanah (Small Mincha)") put an
 * English gloss in the parentheses instead, so the transliteration option
 * shows that gloss for those rows. Nothing here can tell the two apart
 * without a house table this project deliberately doesn't keep (plan.md §5c),
 * and "the whole text is the provider's own" is the trade.
 */
function splitName(name: string): { label: string; translit: string | undefined; footnote: string | undefined } {
  const [core, ...footnoteParts] = name.split(/\s*\|\s*/);
  const footnote = footnoteParts.join(" | ").trim() || undefined;

  const paren = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(core.trim());
  if (paren) {
    const label = paren[1].trim();
    // Strip curly or straight quotes the feed wraps a gloss in.
    const translit = paren[2].replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim() || undefined;
    return { label: label || core.trim(), translit, footnote };
  }
  return { label: core.trim(), translit: undefined, footnote };
}

/**
 * The requested ZIP has to appear in the feed's channel title, or the whole
 * feed is refused and nothing is cached.
 *
 * SAME LOAD-BEARING CHECK the JSON adapter's `verifyLocationName` is, for the
 * same reason: chabad.org falls back to a default location on a bad request
 * and returns a perfectly normal-looking feed for the wrong place. The
 * channel title carries the ZIP ("…for Saint Petersburg, FL 33710 on…"), so a
 * mismatch is caught here rather than cached.
 */
function verifyAndReadLocation(channelTitle: string | null, zip: string): string {
  if (!channelTitle) throw new Error("Chabad zmanim RSS: no channel title to verify the location against");
  if (!channelTitle.includes(zip)) {
    throw new Error(
      `Chabad zmanim RSS: asked for ZIP ${zip} but the feed is titled "${channelTitle}" — ` +
        "refusing it rather than caching another location's times",
    );
  }
  const forOn = /for (.+?) on /i.exec(channelTitle);
  return (forOn ? forOn[1] : channelTitle).trim();
}

/**
 * Fetches and parses one ZIP's zmanim feed (today only), ready to upsert into
 * `zmanim_cache`.
 *
 * `timeZone` is the org's own stored IANA zone, used to turn each item's
 * rendered clock time into an instant. `display` is the feed's own string
 * verbatim — plan.md §5c's "never re-round or recompute provider output."
 */
export async function fetchChabadRssZmanim(input: {
  locationId: string;
  locationType: "1" | "2";
  timeZone: string;
}): Promise<ChabadRssResult> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("locationId", input.locationId);
  url.searchParams.set("locationType", input.locationType);

  const response = await fetch(url, { headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
  if (!response.ok) {
    console.error(`[chabad-zmanim-rss] ${response.status} ${response.statusText} for ${url.toString()}`);
    throw new Error(`Chabad zmanim RSS request failed: ${response.status} ${response.statusText}`);
  }

  const raw = await response.text();
  const channel = /<channel>([\s\S]*)<\/channel>/i.exec(raw)?.[1] ?? raw;
  // The channel's own <title> is before the first <item>; slice it off so
  // `tag` reads the channel title, not an item's.
  const channelHead = channel.split(/<item>/i)[0];
  const location = verifyAndReadLocation(tag(channelHead, "title"), input.locationId);

  // The feed's own date — from <english_date> ("September 14, 2026"), falling
  // back to an item's trailing "(M/D/YYYY)". One date for the whole feed.
  const feedDate = parseEnglishDate(tag(channelHead, "english_date")) ?? parseMdY(/\((\d{1,2})\/(\d{1,2})\/(\d{4})\)/.exec(raw));

  const items = [...channel.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);

  const times: Record<string, Record<string, ChabadZman>> = {};
  const zmanIds = new Set<string>();
  let hasCandleLighting = false;
  let date: string | null = feedDate;

  for (const item of items) {
    const title = tag(item, "title");
    const category = tag(item, "category");
    if (!title) continue;

    // "Dawn (Alot Hashachar) | Fast Begins - 6:02 AM -- (9/14/2026)"
    const [beforeDate, afterDate] = title.split(/\s+--\s+/);
    const itemDate = parseMdY(/\((\d{1,2})\/(\d{1,2})\/(\d{4})\)/.exec(afterDate ?? "")) ?? feedDate;
    if (!itemDate) continue;
    date = itemDate;

    // The display time is the <category>; fall back to the tail of the title.
    const display = (category ?? beforeDate.split(/\s+-\s+/).pop() ?? "").replace(/\s+/g, " ").trim();

    // Strip the trailing " - <time>" the title appends after the name.
    let name = beforeDate.trim();
    if (category && name.endsWith(` - ${category}`)) name = name.slice(0, -(category.length + 3)).trim();
    else name = name.replace(/\s+-\s+[\d:]+(?:\s*[AP]M)?\.?$/i, "").trim();

    const { label, translit, footnote } = splitName(name);
    const id = canonicalIdFor(name);
    zmanIds.add(id);

    const footnoteValue = footnote ? { type: footnote, text: footnote } : undefined;

    // ShaahZmanit is a duration ("62:18 min."), everything else a clock time.
    const shaah = /^(\d{1,3}):(\d{2})\s*min\.?$/i.exec(display);
    if (shaah && Number(shaah[2]) <= 59) {
      times[itemDate] ??= {};
      times[itemDate][id] = {
        durationSeconds: Number(shaah[1]) * 60 + Number(shaah[2]),
        display,
        ...(footnoteValue ? { footnote: footnoteValue } : {}),
        ...(label ? { label } : {}),
        ...(translit ? { translit } : {}),
      };
      continue;
    }

    const clock = parseZmanTime(display);
    if (!clock) continue;

    const [y, mo, d] = itemDate.split("-").map(Number);
    const shift = rollsIntoNextDay(id, clock.hour) ? 1 : 0;
    const anchor = new Date(Date.UTC(y, mo - 1, d + shift));
    const instant = zonedTimeToUtc(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + 1,
      anchor.getUTCDate(),
      clock.hour,
      clock.minute,
      input.timeZone,
    );

    times[itemDate] ??= {};
    times[itemDate][id] = {
      iso: instant.toISOString(),
      display,
      ...(footnoteValue ? { footnote: footnoteValue } : {}),
      ...(label ? { label } : {}),
      ...(translit ? { translit } : {}),
    };
    if (id === "candle_lighting") hasCandleLighting = true;
  }

  const rawResponseByDate: Record<string, unknown> = {};
  if (date) rawResponseByDate[date] = { source: "rss", location, xml: raw };

  const result: ChabadRssResult = {
    times,
    rawResponseByDate,
    location,
    date,
    zmanIds: [...zmanIds].sort(),
    hasCandleLighting,
    bytes: raw.length,
  };

  console.info(
    "[chabad-zmanim-rss] " +
      JSON.stringify({
        url: url.toString(),
        status: response.status,
        bytes: result.bytes,
        location: result.location,
        date: result.date,
        zmanIds: result.zmanIds,
        hasCandleLighting: result.hasCandleLighting,
      }),
  );

  return result;
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "September 14, 2026" -> "2026-09-14", or null for anything else — a
 *  garbled channel date then falls through to an item's own "(M/D/YYYY)". */
function parseEnglishDate(value: string | null): string | null {
  if (!value) return null;
  const match = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(value);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase()) + 1;
  if (month === 0) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}
