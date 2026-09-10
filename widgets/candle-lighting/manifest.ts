import { z } from "zod";
import { hour12Schema, nekudosSchema, scriptSchema } from "@/lib/hebrew/format";
import type { DataNeed, WidgetManifest } from "../types";

/**
 * Which zmanim source this instance uses — plan.md §5c: "provider is a
 * screen-level setting, with per-widget override." `"inherit"` (the
 * default) defers to the board's own resolved provider
 * (lib/board-zmanim.tsx); the other three pin this widget to a specific
 * one regardless of what the screen/org default is. MyZmanim isn't an
 * option here — plan §5c's own decision for this pass is Hebcal and
 * Manual stay client-side, only Chabad gets real infrastructure, MyZmanim
 * gets nothing.
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
  /** Minutes before sunset. Read only when `provider` resolves to
   *  "manual"; ignored otherwise — same shape as the removed Havdalah
   *  widget's own custom-minutes field. 18 matches @hebcal/core's own
   *  Diaspora default (lib/hebrew/candle-times.ts), not a value invented
   *  for this widget. */
  manualMinutesBeforeSunset: z.number().min(0).max(180).default(18),
  /**
   * Whether a date the chosen source has no value for may be computed by
   * Hebcal instead — plan.md §5c's fallback chain, made a choice rather
   * than forced.
   *
   * `true` is the default and the behaviour before this existed: compute
   * it and flag it with "Showing calculated times". `false` shows the
   * unavailable state instead. Some shuls want the time on their board to
   * be their source's or nothing, and with Chabad capped at four weeks
   * (lib/zmanim/warm.ts) that is a real and recurring choice rather than a
   * corner case.
   *
   * Read only when the resolved provider is Chabad — Hebcal and Manual are
   * the computed path, so there is no provider value for them to be
   * missing and turning this off must not blank them.
   */
  fallbackToCalculated: z.boolean().default(true),
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
 * `provider` is checked against "chabad" OR "inherit," not "chabad" alone —
 * deliberately over-inclusive. This function only ever sees the widget's
 * own config, never the screen/org context "inherit" defers to (plan.md
 * §5's own contract: "a function of the instance's config"), so it cannot
 * know whether "inherit" resolves to Chabad at the screen level. Silently
 * returning `[]` for "inherit" would mean the common case — an org whose
 * default provider is Chabad, with every widget left on its own default —
 * never gets its cache warmed at all. Over-including costs an unnecessary
 * cache read on a hebcal-default board with a widget merely left on
 * "inherit"; under-including costs a blank widget on a Chabad-default
 * screen. See lib/bundle/assemble.ts's `needsZmanim` and the proposal this
 * was built from for the fuller reasoning.
 */
function dataNeeds(config: CandleLightingConfig): readonly DataNeed[] {
  if (config.provider !== "chabad" && config.provider !== "inherit") return [];
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
