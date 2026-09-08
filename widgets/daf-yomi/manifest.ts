import { z } from "zod";
import { nekudosSchema, numeralsSchema, scriptSchema, sunsetRolloverSchema } from "@/lib/hebrew/format";
import type { WidgetManifest } from "../types";

export const dafYomiConfigSchema = z.object({
  script: scriptSchema,
  numerals: numeralsSchema,
  nekudos: nekudosSchema,
  sunsetRollover: sunsetRolloverSchema,
  align: z.enum(["left", "center", "right"]).default("center"),
  /** Design pixels. Read in `fixed` and `hug` modes; ignored in `fit`. */
  size: z.number().min(8).max(400).default(72),
  sizingMode: z.enum(["fit", "fixed", "hug"]).default("fixed"),
});

export type DafYomiConfig = z.infer<typeof dafYomiConfigSchema>;

export const manifest: WidgetManifest<DafYomiConfig> = {
  id: "daf-yomi",
  name: "Daf Yomi",
  description: "Today's page in the daily Daf Yomi cycle.",
  category: "time",
  defaultSize: { w: 560, h: 160 },
  isPro: false,
  settingsSchema: dafYomiConfigSchema,
  dataNeeds: () => [],
  /**
   * docs/sizing.md §2: defaults to `fixed`, same reasoning as Clock and
   * Hebrew Date — the daf changes every day, and tractate names vary a lot
   * in length ("Chullin" vs "Bava Kamma" vs "Arachin"), so a `fit`-mode daf
   * would visibly rescale at almost every tractate boundary. Toggleable —
   * a long tractate name can still wrap in a narrow box, which is what
   * makes `hug` genuinely useful here too, same as Parsha.
   */
  sizing: { mode: "fixed", userToggleable: true, minFontSize: 14, maxFontSize: 400 },
};
