import { z } from "zod";
import { hour12Schema } from "@/lib/hebrew/format";
import type { DataNeed, WidgetManifest } from "../types";

/**
 * Which zmanim source this instance uses — plan.md §5c: "provider is a
 * screen-level setting, with per-widget override." Deliberately its own
 * schema rather than an import from candle-lighting/manifest.ts: a widget
 * folder importing another widget folder's schema is the coupling the
 * registry exists to avoid, and the two are free to diverge (MyZmanim
 * becomes an option for one before the other, say).
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
   * IT INTERACTS WITH SIZING, and differently from candle lighting's own
   * three modes. See `sizing` below.
   */
  displayMode: z.enum(["all", "next"]).default("all"),
  hour12: hour12Schema,
  /** Design pixels — one row's type size, not the table's. Read in `fixed`
   *  and `hug`; ignored in `fit`. */
  size: z.number().min(8).max(400).default(32),
  sizingMode: z.enum(["fit", "fixed", "hug"]).default("hug"),
  provider: zmanimProviderSchema,
  /**
   * Whether a zman the chosen source has no value for may be computed by
   * @hebcal/core instead — §5c's fallback chain, made a choice rather than
   * forced. THE SAME SWITCH candle-lighting's config carries, with the
   * same meaning and the same wording on screen; there is one mechanism
   * for this in the product, not two.
   *
   * Read only when the resolved provider is Chabad. Hebcal and Manual are
   * the computed path, so there is no provider value for them to be
   * missing and turning this off must not blank them.
   */
  fallbackToCalculated: z.boolean().default(true),
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
 * `provider` is checked against "chabad" OR "inherit," not "chabad" alone —
 * deliberately over-inclusive, and for the reason candle-lighting's own
 * `dataNeeds` gives at length: this function only ever sees the widget's
 * own config (plan.md §5's contract), so it cannot know whether "inherit"
 * resolves to Chabad at the screen level. Under-including costs a blank
 * table on a Chabad screen whose widgets are all left on the default;
 * over-including costs one unnecessary cache read on a Hebcal board.
 */
function dataNeeds(config: ZmanimConfig): readonly DataNeed[] {
  if (config.provider !== "chabad" && config.provider !== "inherit") return [];
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
   * SIZING — docs/sizing.md §2, worked out per configuration rather than
   * picked. Three modes, two display modes, and only four of the six
   * combinations are honest.
   *
   * **`all` + `hug` — the default, and the only one that cannot overflow.**
   * The row count is mostly a design-time choice, which is §2's own
   * `fixed` case ("any element whose row count is a design-time choice —
   * which zmanim are enabled"), and §2 names Zmanim tables in that
   * sentence. But it is not ONLY design-time here, and that is what tips
   * the default: `candle_lighting` and `shabbos_ends` appear on some dates
   * and not others, so a table containing either has a row count that
   * changes between the Tuesday the gabbai sized the box on and the Friday
   * a room is reading it. `hug` makes that structurally safe.
   *
   * **`all` + `fixed` — honest, and the right choice for most boards.**
   * §2's reasoning holds for a selection with no date-conditional row: the
   * count is fixed by the config, the gabbai deliberately sized the frame,
   * and a box that quietly resizes breaks the layout composed around it.
   * Offered, not forced. A selection that DOES include candle lighting or
   * Shabbos ends can still use it — the growth is at most two rows and a
   * box sized on a Friday holds every other day — so this is a warning in
   * the panel, not a prohibition.
   *
   * **`all` + `fit` — refused.** Not merely worse: the type size would
   * depend on the row count, so the whole table would rescale on the days
   * a date-conditional row appears, and rescale again when it goes. That
   * is Clock's "worst possible behavior for the most-watched element on
   * the board" applied to a table. Settings.tsx moves `fit` to `hug` when
   * `all` is picked, and the Renderer independently ignores fit
   * measurement in this mode so a hand-edited document degrades to its
   * declared size rather than into a scaling loop.
   *
   * **`next` + any of the three — all honest.** One row, always exactly
   * one, so there is no count to vary and nothing to overflow. `fixed`
   * stays the sensible pick and `fit` is defensible here in a way it never
   * is for the table: a single row filling a small box is exactly what §2
   * means by "as legible as its space allows."
   *
   * The manifest default is `hug` because the default display mode is
   * `all`. `userToggleable` so the panel offers the other two.
   */
  sizing: { mode: "hug", userToggleable: true, minFontSize: 14, maxFontSize: 200 },
  instanceLabel: (config) =>
    config.displayMode === "next"
      ? "Zmanim — next only"
      : `Zmanim — ${config.zmanim.length} ${config.zmanim.length === 1 ? "time" : "times"}`,
};
