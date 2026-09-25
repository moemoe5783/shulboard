import { z } from "zod";
import { widgetStyleFields } from "../style";
import type { WidgetManifest } from "../types";

/*
 * Title — a heading and an optional line under it.
 *
 * The plainest widget there is, which makes it the one to copy when adding the
 * fourth. Every field carries a .default(), so parse({}) is the default config
 * and there is no second list of defaults to drift.
 */

export const titleConfigSchema = z.object({
  text: z.string().max(200).default("Untitled"),
  subtitle: z.string().max(200).default(""),
  align: z.enum(["left", "center", "right"]).default("left"),
  /** Sub-line size, as a fraction of the title's. */
  subtitleScale: z.number().min(0.1).max(1).default(0.45),
  /** The title's size in design units. Read in `fixed` and `hug` modes; `fit`
   *  computes its own. */
  size: z.number().min(8).max(400).default(96),
  /** Fit to box (the default), Fixed size or Hug height — docs/sizing.md §2. */
  sizingMode: z.enum(["fit", "fixed", "hug"]).default("fit"),
  // Background, colour, font, padding, radius, border, shadow and header —
  // shared appearance for every widget (../style.ts).
  ...widgetStyleFields,
});

export type TitleConfig = z.infer<typeof titleConfigSchema>;

export const manifest: WidgetManifest<TitleConfig> = {
  id: "title",
  name: "Title",
  description: "A heading, with a line under it if you want one.",
  category: "text",
  defaultSize: { w: 800, h: 200 },
  isPro: false,
  settingsSchema: titleConfigSchema,
  // Nothing to fetch. It says what it is told to say.
  dataNeeds: () => [],
  /**
   * docs/sizing.md §2: a title's whole job is to be as legible as its space
   * allows, and nobody designing signage thinks in points — they think "big
   * enough to read from the back." So fit is the default. It is toggleable
   * all the same: two titles meant to match, or one that should stay one size
   * whatever its wording, want Fixed size.
   */
  sizing: { mode: "fit", userToggleable: true, minFontSize: 8, maxFontSize: 400 },
  instanceLabel: (config) => config.text || "Title",
};
