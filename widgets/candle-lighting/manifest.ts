import { z } from "zod";
import { hour12Schema, nekudosSchema, scriptSchema } from "@/lib/hebrew/format";
import type { DataNeed, WidgetManifest } from "../types";

/**
 * Which zmanim source this instance uses — plan.md §5c's "per-widget
 * override".
 *
 * UNREAD, AND KEPT ON PURPOSE. Chabad.org is the only source
 * (lib/zmanim/provider.ts), so there is nothing to override and the
 * Settings panel no longer offers the choice — a one-item dropdown is not
 * a setting. The field stays in the schema, with all four values, for the
 * same reason the DB enum keeps them: a stored board document written
 * while the choice existed still parses, and re-offering the choice later
 * is a Settings control plus a read here, not a document migration.
 *
 * Nothing may branch on this. `dataNeeds` below used to and no longer
 * does.
 */
export const candleLightingProviderSchema = z.enum(["inherit", "hebcal", "chabad", "manual"]).default("inherit");

export const candleLightingConfigSchema = z.object({
  /** The "Candle lighting" label's own language — the time itself has no
   *  script, only numerals, so there is no separate numerals option here. */
  script: scriptSchema,
  /** Only affects the Hebrew half of the label. */
  nekudos: nekudosSchema,
  hour12: hour12Schema,
  showCountdown: z.boolean().default(true),
  align: z.enum(["left", "center", "right"]).default("center"),
  /** Design pixels. Read in `fixed` and `hug` modes; ignored in `fit`. */
  size: z.number().min(8).max(400).default(72),
  sizingMode: z.enum(["fit", "fixed", "hug"]).default("fixed"),
  provider: candleLightingProviderSchema,
  /** Minutes before sunset — the Manual provider's own field, unread for
   *  the same reason `provider` is. Chabad publishes candle lighting 18
   *  minutes before sunset itself (its request's own `before=18`), so
   *  there is nothing for this to adjust. */
  manualMinutesBeforeSunset: z.number().min(0).max(180).default(18),
  /**
   * How many of the week's candle lightings to show at once.
   *
   * A week routinely has more than one: Erev Yom Kippur on a Sunday sits
   * in the same week as the Friday before it, and a two-day Yom Tov
   * abutting Shabbos produces a run. `"next"` is the behaviour before this
   * existed.
   *
   * `"all"` INTERACTS WITH SIZING — docs/sizing.md §2. The entry count
   * varies week to week (one most weeks, two or three around the chagim),
   * which is exactly that section's "content whose amount, not whose row
   * design, changes at runtime" and therefore exactly what `hug` is for:
   * overflow is structurally impossible in that mode rather than something
   * to warn about. In `fixed` the same box either clips the busy week or
   * sits mostly empty the rest of the year — §2's own words. In `fit` it
   * is worse than either: the type would rescale between one entry and
   * three, hit `minFontSize`, and then overflow anyway. So Settings.tsx
   * switches `sizingMode` to `"hug"` when this is set to `"all"`, and the
   * Renderer additionally ignores fit measurement in this mode so a
   * hand-edited `fit` config degrades to the declared size rather than to
   * a scaling loop.
   */
  displayMode: z.enum(["next", "all", "rotate"]).default("next"),
});

export type CandleLightingConfig = z.infer<typeof candleLightingConfigSchema>;

/**
 * Unconditional now. This used to check the widget's own `provider`
 * against "chabad" or "inherit" — deliberately over-inclusive, because a
 * `dataNeeds` function only ever sees its own instance's config (plan.md
 * §5's contract) and could not tell what "inherit" resolved to. With
 * Chabad.org the only source, every instance of this widget needs the
 * cache and the branch had one outcome.
 */
function dataNeeds(): readonly DataNeed[] {
  return [{ kind: "zmanim", provider: "chabad" }];
}

export const manifest: WidgetManifest<CandleLightingConfig> = {
  id: "candle-lighting",
  name: "Candle lighting",
  description: "Candle-lighting times, with a countdown.",
  category: "time",
  defaultSize: { w: 640, h: 220 },
  isPro: false,
  settingsSchema: candleLightingConfigSchema,
  dataNeeds,
  /**
   * docs/sizing.md §2: defaults to `fixed`, Clock's own reasoning applied to
   * a second live-updating readout — the countdown's own digit count keeps
   * changing shape ("in 2h 15m" -> "in 9m" -> "in 42s"), which is the exact
   * "worst possible behavior" case for `fit` mode Clock's manifest already
   * names, just one level more volatile since it ticks every minute rather
   * than every digit rollover. Toggleable — a two-line time+countdown block
   * can still legitimately want to hug its own height.
   */
  sizing: { mode: "fixed", userToggleable: true, minFontSize: 14, maxFontSize: 400 },
};
