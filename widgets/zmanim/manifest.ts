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
  /** The table's type size, in board design units. NOT authoritative for
   *  rendering — the width of the box drives the actual size (see `sizing`) — but
   *  kept in step with it by the properties panel's type field (which resizes the
   *  box to a typed size), so it persists the intended size and is what the
   *  relative padding and header scale against (widgets/style.ts). */
  size: z.number().min(8).max(400).default(32),
  /**
   * What happens when more rows are chosen than fit the box height. Never
   * shrinks the type (the width sets that) — instead:
   *  - `page`: show a screenful of whole rows, then cycle to the next.
   *  - `scroll`: scroll the rows continuously, like a departures board.
   */
  overflow: z.enum(["page", "scroll"]).default("page"),
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
  // Times, zmanim or a date: no script faces offered, lining digits (widgets/types.ts).
  showsTimes: true,
  dataNeeds,
  /**
   * SIZING — WIDTH-DRIVEN TYPE, VERTICAL SCROLL/PAGE (widgets/zmanim/fit.ts and
   * Renderer.tsx). The box's WIDTH sets the type size (as large as fits the
   * widest row across it); the box's HEIGHT never rescales the type — extra rows
   * scroll or page (config.overflow), never shrink.
   *
   * `mode: "fit"` so the panel's "Type size" field is a LIVE readout of the
   * rendered size and resizes the BOX to a typed size (PropertiesPanel) — which
   * is what "the number should match the text and typing one should resize the
   * box" means. `userToggleable: false`: a luach has one right behaviour, no
   * mode toggle. `minFontSize`/`maxFontSize` bound the width-driven size.
   */
  sizing: { mode: "fit", userToggleable: false, minFontSize: 6, maxFontSize: 400 },
  instanceLabel: (config) =>
    config.displayMode === "next"
      ? "Zmanim — next only"
      : `Zmanim — ${config.zmanim.length} ${config.zmanim.length === 1 ? "time" : "times"}`,
};
