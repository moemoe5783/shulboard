import { z } from "zod";
import { nekudosSchema, scriptSchema } from "@/lib/hebrew/format";
import type { WidgetManifest } from "../types";

export const parshaConfigSchema = z.object({
  script: scriptSchema,
  nekudos: nekudosSchema,
  align: z.enum(["left", "center", "right"]).default("center"),
  /** Design pixels. Read in `fixed` and `hug` modes; ignored in `fit`. */
  size: z.number().min(8).max(400).default(80),
  sizingMode: z.enum(["fit", "fixed", "hug"]).default("fit"),
});

export type ParshaConfig = z.infer<typeof parshaConfigSchema>;

export const manifest: WidgetManifest<ParshaConfig> = {
  id: "parsha",
  name: "Parsha",
  description: "This week's Torah portion.",
  category: "time",
  defaultSize: { w: 640, h: 160 },
  isPro: false,
  settingsSchema: parshaConfigSchema,
  dataNeeds: () => [],
  /**
   * docs/sizing.md §2: defaults to `fit`, deliberately unlike Clock/Hebrew
   * Date/Daf Yomi — a parsha name's LENGTH is what genuinely varies week to
   * week (`Noach` vs `Nitzavim-Vayeilech`), not a digit count inside an
   * otherwise-fixed format, so there's no "worst possible behavior" case for
   * rescaling here the way there is for a clock: this is a short, variable-
   * length label whose whole job is to fill its box, exactly title's own
   * reasoning ("big enough to read from the back"). `hug` is genuinely
   * useful too, unlike for Clock (which never wraps, §7): a doubled parsha
   * name can wrap to two lines in a narrow box, and hug's height then
   * grows to hold both rather than clipping the second line. All three
   * modes are defensible, so it's toggleable.
   */
  sizing: { mode: "fit", userToggleable: true, minFontSize: 12, maxFontSize: 400 },
};
