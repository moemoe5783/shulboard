import { z } from "zod";
import { hour12Schema } from "@/lib/hebrew/format";
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
  /** Design pixels — one row's type size, not the table's. Read in `fixed`
   *  and `hug`; ignored in `fit`. */
  size: z.number().min(8).max(400).default(32),
  sizingMode: z.enum(["fit", "fixed", "hug"]).default("fit"),
  provider: zmanimProviderSchema,
  /**
   * What to do when the chosen rows don't fit the box.
   *
   * A SEPARATE AXIS FROM SIZING, and that separation is what makes `fit`
   * recommendable — see the `sizing` note below. Sizing decides how big the
   * type is; this decides what happens to the rows that still don't fit at
   * that size.
   *
   * - `"page"` (default) — a screenful at a time, holding each still for
   *   eight seconds, then a plain swap to the next. The default because it
   *   is inert when nothing overflows and never loses a row when something
   *   does, so it is never the wrong choice, only sometimes an unused one.
   * - `"scroll"` — one continuous slow creep through the list, seamless.
   *   Right for a long list where a congregant wants any row to come round
   *   soon rather than a still frame.
   * - `"clip"` — the rows that don't fit are cut off, which is
   *   docs/sizing.md §3's own rule for `fit` and `fixed`. Honest when a
   *   gabbai wants a fixed frame and knows what is in it; the panel warns
   *   when it is paired with a selection that can grow.
   *
   * Inert in `hug` (the box grows to its content, so nothing can overflow)
   * and in `"next"` display mode (one row).
   */
  overflow: z.enum(["page", "scroll", "clip"]).default("page"),
  /**
   * How fast `overflow: "scroll"` creeps — 30, 60 or 120 board design
   * units per second (`SCROLL_UNITS_PER_SECOND` in ./overflow.ts, which
   * has the arithmetic behind the numbers).
   *
   * A setting rather than a constant because the old constant 16 was too
   * slow to be useful and there was no way to say so from the panel. An
   * enum rather than a number because units-per-second is not a quantity a
   * gabbai can judge without standing in the lobby, while "slower" and
   * "faster" are.
   */
  scrollSpeed: z.enum(["slow", "medium", "fast"]).default("medium"),
  /**
   * Which language the row labels are in.
   *
   * `"english"` and `"hebrew"` are both THE PROVIDER'S OWN WORDS where
   * there are any — Chabad sends "Latest Shacharit" and "סוף זמן תפילה",
   * and the board shows whichever was asked for. There is no house Hebrew
   * table: a row with no Hebrew from the provider falls back to its
   * English, because putting a zman under a Hebrew name this project
   * asserted would be a halachic claim rather than a translation.
   *
   * A ROW MAY WELL HAVE NO HEBREW. Only the response's nested
   * `TimeGroups` shape carries `HebrewTitle`; the flat shape the 92-day
   * request returns has none at all, and which parameter switches between
   * them is unresolved — see lib/zmanim/chabad-adapter.ts. So this is a
   * setting that may currently do nothing for a given shul's cache, and
   * Settings.tsx says so rather than leaving it looking broken.
   *
   * HEBREW IS RTL, and the table mirrors: the label and time columns swap
   * sides rather than staying put. That is one `dir="rtl"` on the grid —
   * see the Renderer.
   */
  labelScript: z.enum(["english", "hebrew"]).default("english"),
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
   * SIZING — docs/sizing.md §2. `fit` IS RECOMMENDED, AND THAT REVERSES AN
   * EARLIER CONCLUSION ON PURPOSE. The reversal is worth stating because
   * the earlier reasoning was right about the mechanism and wrong about
   * what could be done with it.
   *
   * THE OLD ARGUMENT: `fit` was refused for `all` because the fitted type
   * size depends on the row count, and two of the canonical zmanim
   * (`candle_lighting`, `shabbos_ends`) appear on some dates and not
   * others — so the whole table would rescale on Friday and rescale back
   * on Sunday. That is Clock's "worst possible behavior for the
   * most-watched element" applied to a table, and it is still true of a
   * `fit` that re-measures on every row-count change.
   *
   * WHAT CHANGED, TWICE. The first answer padded the measured list to the
   * declared selection count with spacer rows, so the count the fit saw
   * could not vary. The second and current answer is better: the size does
   * not depend on the row count at all. It is
   * `min(boxHeight / (8 rows × per-row height), boxWidth / row width)` —
   * ./fit.ts — so a returning candle-lighting row changes nothing about
   * the height term, and the spacers had nothing left to hold steady.
   *
   * That also means fit DOES now need the overflow mode, where the spacer
   * version did not: the height term deliberately ignores how many rows
   * there are, so a twelve-row selection in a box sized for eight
   * overflows by design and scrolls or pages. Vertical overflow is
   * acceptable; horizontal truncation is not, which is the second term.
   *
   * THE SPACERS ARE GONE, and so is the binary search — `fit` means
   * something different here now, and ./fit.ts is the whole argument. In
   * short: the size is `min(height-driven, width-allowed)`, width is never
   * compromised, height may overflow into the scroll or page mode above.
   * Neither term reads the row count, so there is nothing left for a
   * spacer to hold steady, and a spacer would now actively hurt by
   * inflating the content height the overflow check reads.
   *
   * WHERE `fit` IS STILL NOT RECOMMENDED: `"next"` display mode. One row,
   * and the row's own label changes through the day ("Sunrise", then
   * "Latest Shacharit", then "Midnight"), so a width-constrained single
   * row rescales with its label's length several times a day. `next` keeps
   * `fixed` as the sensible pick; Settings.tsx says so rather than
   * switching the mode, because all three are legible there and only one
   * is jumpy.
   *
   * `all` + `fixed` and `all` + `hug` both stay fully honest and offered —
   * §2 names zmanim tables as its own `fixed` example, and `hug` is the one
   * mode where overflow is structurally impossible.
   *
   * `recommended` is what puts "Fit to box is recommended for this
   * element" under the panel's toggle.
   */
  sizing: { mode: "fit", userToggleable: true, recommended: "fit", minFontSize: 14, maxFontSize: 200 },
  instanceLabel: (config) =>
    config.displayMode === "next"
      ? "Zmanim — next only"
      : `Zmanim — ${config.zmanim.length} ${config.zmanim.length === 1 ? "time" : "times"}`,
};
