import { gematriya, Locale, type HDate, type ParshaEvent } from "@hebcal/core";
import type { DafPage } from "@hebcal/learning";
import { z } from "zod";

/*
 * The six format options plan.md §5 lists under "Hebrew/format options", as
 * reusable zod field schemas rather than one shared config object — every
 * widget in this batch needs a different subset (a clock time has no script
 * to pick, a parsha name has no year to prefix), and CLAUDE.md/clock's own
 * manifest already establish flat, per-widget config as the convention. A
 * widget spreads in only the fields it has an opinion about.
 *
 * Every field carries the `.default()` the registry's `defaultConfig()`
 * (widgets/manifests.ts) depends on.
 */

export const scriptSchema = z.enum(["hebrew", "transliterated", "both"]).default("both");
export type HebrewScript = z.infer<typeof scriptSchema>;

export const numeralsSchema = z.enum(["gematria", "latin"]).default("gematria");
export type HebrewNumerals = z.infer<typeof numeralsSchema>;

/** Only visible in the Hebrew half of "both", and only meaningful when
 *  numerals is "gematria" — see PropertiesPanel usage in each Settings.tsx. */
export const yearPrefixSchema = z.boolean().default(false);

export const nekudosSchema = z.boolean().default(true);

/** plan.md §5: "does the Hebrew date flip at sunset or midnight". Defaults to
 *  the halachically correct answer — see docs on effectiveHebrewDate. */
export const sunsetRolloverSchema = z.boolean().default(true);

export const hour12Schema = z.boolean().default(true);

/**
 * One or two rendered lines — populated for whichever script(s) `opts` asked
 * for, so a Renderer can lay out "both" without re-deriving which half is
 * live. Never both null: every caller here asks for at least one script.
 */
export type ScriptedText = { hebrew: string | null; english: string | null };

const PARASHAT_PREFIXES = ["פָּרָשַׁת ", "פרשת ", "Parashat "];

/** `render()` on a parsha (regular or chag) always carries a "Parashat"/
 *  "פרשת" prefix (docs measured against @hebcal/core) — stripped here so
 *  script and transliterated forms read the same way: the bare name, same as
 *  `ParshaEvent.basename()` already does for English. */
function stripParashatPrefix(text: string): string {
  for (const prefix of PARASHAT_PREFIXES) {
    if (text.startsWith(prefix)) return text.slice(prefix.length);
  }
  return text;
}

function hebrewLocale(nekudos: boolean): "he" | "he-x-NoNikud" {
  return nekudos ? "he" : "he-x-NoNikud";
}

/**
 * A Hebrew calendar date, in board design's own vocabulary.
 *
 * Numerals apply only to the Hebrew half — mixing transliteration with
 * gematria numerals ("Tishrei, א׳, תשפ״ז") isn't a real option anyone wants,
 * so the English half is always Latin digits, same as `HDate.render('en')`
 * already gives for free.
 *
 * `yearPrefix` (the ה׳ thousands marker) only has meaning with gematria
 * numerals — ה׳ prepended to a Latin "5786" is not a thing anyone writes.
 * Ignored under `numerals: 'latin'`.
 */
export function formatHebrewDate(
  hdate: HDate,
  opts: { script: HebrewScript; numerals: HebrewNumerals; nekudos: boolean; yearPrefix: boolean },
): ScriptedText {
  const english = opts.script !== "hebrew" ? hdate.render("en") : null;

  let hebrew: string | null = null;
  if (opts.script !== "transliterated") {
    if (opts.numerals === "gematria") {
      const dayMonth = hdate.renderGematriya(!opts.nekudos, true);
      const year = gematriya(hdate.getFullYear());
      hebrew = `${dayMonth} ${opts.yearPrefix ? "ה׳" : ""}${year}`;
    } else {
      hebrew = hdate.render(hebrewLocale(opts.nekudos));
    }
  }

  return { hebrew, english };
}

/**
 * This week's (or this Shabbos's) parsha. No numerals option — a parsha name
 * carries no digits — and no sunset rollover: `sedra.lookup()` already keys
 * off the civil Shabbos boundary, which is the correct boundary for "which
 * parsha is current" regardless of tonight's sunset (see hebrew-date's own
 * civil-day.ts for why the *date* widget needs sunset and this one doesn't).
 */
export function formatParsha(parsha: ParshaEvent, opts: { script: HebrewScript; nekudos: boolean }): ScriptedText {
  const english = opts.script !== "hebrew" ? parsha.basename() : null;
  const hebrew =
    opts.script !== "transliterated"
      ? stripParashatPrefix(parsha.render(hebrewLocale(opts.nekudos)))
      : null;
  return { hebrew, english };
}

/**
 * A Daf Yomi page — tractate name plus page number, each independently
 * translated/renumbered rather than taken from the library's own
 * `render('he')` (which always renders the page number in gematria,
 * coupling the two axes plan.md §5 asks to be independent).
 */
export function formatDaf(
  daf: DafPage,
  opts: { script: HebrewScript; numerals: HebrewNumerals; nekudos: boolean },
): ScriptedText {
  const english = opts.script !== "hebrew" ? `${daf.name} ${daf.blatt}` : null;

  let hebrew: string | null = null;
  if (opts.script !== "transliterated") {
    const name = Locale.lookupTranslation(daf.name, hebrewLocale(opts.nekudos)) ?? daf.name;
    const page =
      opts.numerals === "gematria" && typeof daf.blatt === "number" ? gematriya(daf.blatt) : String(daf.blatt);
    hebrew = `${name} ${page}`;
  }

  return { hebrew, english };
}

/** The plain-language label on a candle-lighting or Havdalah event ("Candle
 *  lighting" / "הַדְלָקַת נֵרוֹת") — @hebcal/core's own translation via
 *  `renderBrief`, which both `CandleLightingEvent` and `HavdalahEvent`
 *  inherit from `TimedEvent`, needs no formatting of our own. */
export function formatEventLabel(
  event: { renderBrief(locale?: string): string },
  opts: { script: HebrewScript; nekudos: boolean },
): ScriptedText {
  const english = opts.script !== "hebrew" ? event.renderBrief("en") : null;
  const hebrew = opts.script !== "transliterated" ? event.renderBrief(hebrewLocale(opts.nekudos)) : null;
  return { hebrew, english };
}

/** A clock-style time of day, in a specific zone — candle lighting and
 *  Havdalah both need exactly this, formatted the same way Clock formats
 *  its own display (Intl, not the library's own locale-formatted string,
 *  because that's what respects the widget's own 12/24h config). */
export function formatTimeOfDay(date: Date, opts: { hour12: boolean; timeZone: string }): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: opts.hour12,
    timeZone: opts.timeZone,
  }).format(date);
}

/**
 * "in 2d 3h", "in 45m", "now" — candle lighting and Havdalah's own
 * countdown. Coarsest-unit-first and two units at most: a countdown reads at
 * a glance across a room, and "in 2 days, 3 hours, 14 minutes and 8 seconds"
 * does not.
 */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "now";

  const totalMinutes = Math.floor(msRemaining / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m`;
  return "in under a minute";
}
