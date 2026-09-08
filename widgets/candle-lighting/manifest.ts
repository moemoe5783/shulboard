import { z } from "zod";
import { hour12Schema, nekudosSchema, scriptSchema } from "@/lib/hebrew/format";
import type { WidgetManifest } from "../types";

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
});

export type CandleLightingConfig = z.infer<typeof candleLightingConfigSchema>;

export const manifest: WidgetManifest<CandleLightingConfig> = {
  id: "candle-lighting",
  name: "Candle lighting",
  description: "The next candle-lighting time, with a countdown.",
  category: "time",
  defaultSize: { w: 640, h: 220 },
  isPro: false,
  settingsSchema: candleLightingConfigSchema,
  dataNeeds: () => [],
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
