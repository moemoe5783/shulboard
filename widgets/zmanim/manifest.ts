import { z } from "zod";
import { hour12Schema } from "@/lib/hebrew/format";
import { widgetStyleFields } from "../style";
import type { DataNeed, WidgetManifest } from "../types";

/**
 * Which zmanim source this instance uses — plan.md §5c's "per-widget
 * override".
 *
 * UNREAD, AND KEPT ON PURPOSE, exactly as candle-lighting/manifest.ts's own
 * copy of this is. Chabad.org is the only source
 * (lib/zmanim/provider.ts), so there is nothing to override; the field
 * stays so a stored document keeps parsing and re-offering the choice
 * later is a Settings control plus a read, not a migration. Nothing may
 * branch on it.
 */
export const zmanimProviderSchema = z.enum(["inherit", "hebcal", "chabad", "manual"]).default("inherit");

/**
 * What a board shows when nobody has chosen — seven rows, and the seven a
 * shul lobby board actually carries.
 *
 * Netz and shkia because they bound the day; the two morning deadlines
 * because they are the ones people are late for; chatzos and plag because
 * they gate mincha and maariv; tzeis because it ends the day. Left out of
 * the default and one click away: alos and misheyakir (before almost
 * anyone is in the building), mincha gedola and ketana (a davening
 * schedule usually names these by their minyan time instead), chatzos
 * halayla, and the two date-conditional rows.
 *
 * Seven is also a number that fits: at the default type size a seven-row
 * table sits inside the default box, so a widget dropped on a board and
 * left alone looks composed rather than clipped.
 */
const DEFAULT_ZMANIM = [
  "netz",
  "sof_zman_shma_baal_hatanya",
  "sof_zman_tfila_baal_hatanya",
  "chatzos",
  "plag_hamincha",
  "shkia",
  "tzeis_baal_hatanya",
];

export const zmanimConfigSchema = z.object({
  /**
   * Canonical zman ids — plan.md §5c's vocabulary, not Chabad's
   * `EssentialZmanType` and not a display string.
   *
   * THE CANONICAL ID IS INVISIBLE PLUMBING. It is what makes a board
   * document survive a provider change: the same `netz` row reads from
   * Chabad today and from MyZmanim after a settings change, with nothing
   * in the document edited. What reaches the screen is always the
   * provider's own label for that id (lib/zmanim/zman.ts's note on
   * `label`), so the id never surfaces to anyone.
   *
   * A plain string array rather than an enum of the ids that exist today,
   * on purpose. §5c's vocabulary is still growing — four ids were added to
   * it by the work that made this widget possible — and a zod enum here
   * would turn every future addition into a schema migration for stored
   * board documents. An id nothing supplies simply resolves to no row
   * (lib/zmanim/resolve-zmanim.ts), which is the same thing that happens
   * to `candle_lighting` on a Tuesday.
   */
  zmanim: z.array(z.string()).default(DEFAULT_ZMANIM),
  /**
   * The whole table, or only the row about to happen.
   *
   * `"all"` is the default because that is what a shul means by a zmanim
   * board: the luach, chronological, read at a glance. `"next"` is the
   * variant for a small box beside something else — one row, whichever is
   * coming, which by 2 AM means tomorrow's alos (resolve-zmanim.ts's
   * today/tomorrow rule).
   *
   * IT INTERACTS WITH SIZING: `fit` is recommended for `"all"` and is the
   * one configuration `"next"` should not use. See `sizing` below.
   */
  displayMode: z.enum(["all", "next"]).default("all"),
  hour12: hour12Schema,
  /** Design pixels — used only for the empty-state message's size now. The
   *  table itself is always fit-to-box (see `sizing`); the box is what sets
   *  its size. Kept in the schema so stored documents keep parsing. */
  size: z.number().min(8).max(400).default(32),
  provider: zmanimProviderSchema,
  /**
   * Which form the row labels take: the English name, or the Hebrew zman name
   * spelled in Latin letters (the transliteration).
   *
   * BOTH ARE THE PROVIDER'S OWN WORDS. The RSS feed writes each name as
   * "English (Transliteration)" — "Dawn (Alot Hashachar)" — so `"english"`
   * shows "Dawn" and `"transliteration"` shows "Alot Hashachar", from
   * Chabad's own text (lib/zmanim/chabad-rss.ts). There is no house table.
   *
   * A ROW MAY HAVE NO TRANSLITERATION. The feed is inconsistent — "Latest
   * Shema" has no parenthetical at all — so a row with none falls back to its
   * English rather than to a name this project invented (plan.md §5c).
   *
   * NO HEBREW-SCRIPT OPTION for now: the RSS feed carries no Hebrew script,
   * only the Latin transliteration. Both forms render left-to-right, so
   * nothing mirrors.
   *
   * Legacy `"hebrew"` (from before the feed switch) is read forward as
   * `"transliteration"` so a stored board keeps parsing.
   */
  labelScript: z
    .preprocess((value) => (value === "hebrew" ? "transliteration" : value), z.enum(["english", "transliteration"]))
    .default("english"),
  // Background, text colour, font, padding, radius — board content, shared
  // with candle lighting (../style.ts).
  ...widgetStyleFields,
  /**
   * The provider's halachic footnotes, under the table.
   *
   * OFF BY DEFAULT because of what they actually are: full sentences
   * ("The menorah must burn for at least 30 minutes after nightfall...")
   * written for a printed luach a person holds, not for a board read from
   * twenty feet. They are cached rather than dropped because they are
   * halachically meaningful — `LightCandlesAfter` on a Shabbos-end row is
   * the second night of a two-day Yom Tov — so a shul that wants them on
   * its board can have them, at the cost of the space they take.
   */
  showFootnotes: z.boolean().default(false),
});

export type ZmanimConfig = z.infer<typeof zmanimConfigSchema>;

/**
 * Unconditional — Chabad.org is the only source, so every instance of this
 * widget needs the cache. This used to branch on the widget's own
 * `provider` field; that field is now unread (see its schema note).
 */
function dataNeeds(): readonly DataNeed[] {
  return [{ kind: "zmanim", provider: "chabad" }];
}

export const manifest: WidgetManifest<ZmanimConfig> = {
  id: "zmanim",
  name: "Zmanim",
  description: "A luach of the day's zmanim, from the shul's own source.",
  category: "content",
  defaultSize: { w: 560, h: 400 },
  isPro: false,
  settingsSchema: zmanimConfigSchema,
  dataNeeds,
  /**
   * SIZING — FIT TO BOX, AND ONLY FIT TO BOX. The table always scales so the
   * whole thing — every row's full text and all the rows stacked — fits the
   * box, shrinking as far as it must so nothing is ever cut off or scrolled
   * (widgets/zmanim/fit.ts). Fixed size, Hug height and the old
   * scroll/page/clip overflow modes are gone: a busier day or a smaller box
   * renders smaller rather than clipping or paging.
   *
   * `userToggleable: false`, so the panel shows no mode switch. The "Type
   * size" field it does show is editable and resizes the BOX to that size
   * (PropertiesPanel) — enter a size and the box grows or shrinks so the
   * content renders at it; on the board, if content later grows, the type
   * shrinks to fit rather than overflowing.
   *
   * `minFontSize` is low so "shrink to fit" almost never bottoms out — the
   * priority is never cutting content off, even small.
   */
  sizing: { mode: "fit", userToggleable: false, minFontSize: 6, maxFontSize: 200 },
  instanceLabel: (config) =>
    config.displayMode === "next"
      ? "Zmanim — next only"
      : `Zmanim — ${config.zmanim.length} ${config.zmanim.length === 1 ? "time" : "times"}`,
};
