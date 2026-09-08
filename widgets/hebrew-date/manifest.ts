import { z } from "zod";
import { nekudosSchema, numeralsSchema, scriptSchema, sunsetRolloverSchema, yearPrefixSchema } from "@/lib/hebrew/format";
import type { WidgetManifest } from "../types";

export const hebrewDateConfigSchema = z.object({
  script: scriptSchema,
  numerals: numeralsSchema,
  /** The ה׳ thousands marker — only visible with `numerals: 'gematria'`. */
  yearPrefix: yearPrefixSchema,
  nekudos: nekudosSchema,
  sunsetRollover: sunsetRolloverSchema,
  align: z.enum(["left", "center", "right"]).default("center"),
  /** Design pixels. Read in `fixed` and `hug` modes; ignored in `fit`. */
  size: z.number().min(8).max(400).default(96),
  sizingMode: z.enum(["fit", "fixed", "hug"]).default("fixed"),
});

export type HebrewDateConfig = z.infer<typeof hebrewDateConfigSchema>;

export const manifest: WidgetManifest<HebrewDateConfig> = {
  id: "hebrew-date",
  name: "Hebrew date",
  description: "Today's date on the Hebrew calendar.",
  category: "time",
  defaultSize: { w: 640, h: 180 },
  isPro: false,
  settingsSchema: hebrewDateConfigSchema,
  // Computed client-side from the system clock and the board's own location
  // (plan.md §3b) — nothing to fetch.
  dataNeeds: () => [],
  /**
   * docs/sizing.md §2: defaults to `fixed`, same reasoning as Clock — the
   * Hebrew date changes once a day, but the MONTH NAME's length still
   * varies a lot ("Iyar" vs "Marcheshvan"), and a fit-mode date would
   * visibly resize itself at every month boundary, which is the same
   * "worst possible behavior" Clock's own manifest already argues against
   * for the far more frequent digit-count case. All three modes are still
   * defensible (a single line, exactly like Clock), so it's toggleable.
   */
  sizing: { mode: "fixed", userToggleable: true, minFontSize: 16, maxFontSize: 400 },
};
