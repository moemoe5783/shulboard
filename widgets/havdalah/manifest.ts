import { z } from "zod";
import { havdalahCustomMinutesSchema, havdalahShitahSchema } from "@/lib/hebrew/candle-times";
import { hour12Schema, nekudosSchema, scriptSchema } from "@/lib/hebrew/format";
import type { WidgetManifest } from "../types";

export const havdalahConfigSchema = z.object({
  /** The "Havdalah" label's own language — the time itself has no script,
   *  only numerals, so there is no separate numerals option here. */
  script: scriptSchema,
  /** Only affects the Hebrew half of the label. */
  nekudos: nekudosSchema,
  hour12: hour12Schema,
  showCountdown: z.boolean().default(true),
  align: z.enum(["left", "center", "right"]).default("center"),
  /** Design pixels. Read in `fixed` and `hug` modes; ignored in `fit`. */
  size: z.number().min(8).max(400).default(72),
  sizingMode: z.enum(["fit", "fixed", "hug"]).default("fixed"),
  /** Which definition of nightfall Havdalah waits for — see
   *  lib/hebrew/candle-times.ts's own doc comment for what each value means
   *  and why hebcal's astronomical default isn't necessarily a given shul's
   *  practice. */
  shitah: havdalahShitahSchema,
  /** Minutes after sunset. Read only when shitah is "custom"; ignored
   *  otherwise — same shape as this schema's own size/sizingMode pair. */
  customMinutes: havdalahCustomMinutesSchema,
});

export type HavdalahConfig = z.infer<typeof havdalahConfigSchema>;

export const manifest: WidgetManifest<HavdalahConfig> = {
  id: "havdalah",
  name: "Havdalah",
  description: "When Shabbos or Yom Tov ends, with a countdown.",
  category: "time",
  defaultSize: { w: 640, h: 220 },
  isPro: false,
  settingsSchema: havdalahConfigSchema,
  dataNeeds: () => [],
  // docs/sizing.md §2: same reasoning as Candle Lighting's own manifest — a
  // live countdown's digit count keeps changing shape, which `fixed` avoids
  // rescaling around. Toggleable for the same reason.
  sizing: { mode: "fixed", userToggleable: true, minFontSize: 14, maxFontSize: 400 },
};
