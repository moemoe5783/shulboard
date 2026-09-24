import { z } from "zod";
import { widgetStyleFields } from "../style";
import type { WidgetManifest } from "../types";

/*
 * Text — a paragraph or a few lines: a notice, a dedication, a schedule note.
 *
 * Title's sibling with the opposite default. A title fills its box; body text
 * is set at a size and wraps inside its box (`fixed`), the way text on a
 * printed notice does, so a paragraph reads at the same size as the one beside
 * it. `hug` grows the box to fit the text instead, and `fit` shrinks the text
 * to fill the box, for the sign that has to hold whatever it's given.
 */

export const textConfigSchema = z.object({
  /** Line breaks are kept. Hebrew and English both work; each line sets its
   *  own direction from its first letters. */
  text: z.string().max(5000).default("Add your text here."),
  align: z.enum(["left", "center", "right", "justify"]).default("left"),
  /** Where the text sits in a box taller than it. */
  verticalAlign: z.enum(["top", "middle", "bottom"]).default("top"),
  /** Design units. Read in `fixed` and `hug` modes; `fit` computes its own. */
  size: z.number().min(8).max(400).default(40),
  /** Line spacing, as a multiple of the type size. */
  lineHeight: z.number().min(0.9).max(2.5).default(1.35),
  bold: z.boolean().default(false),
  sizingMode: z.enum(["fit", "fixed", "hug"]).default("fixed"),
  // Background, colour, font, padding, radius, border, shadow and header —
  // shared appearance for every widget (../style.ts).
  ...widgetStyleFields,
});

export type TextConfig = z.infer<typeof textConfigSchema>;

export const manifest: WidgetManifest<TextConfig> = {
  id: "text",
  name: "Text",
  description: "A paragraph or a few lines, set at a size you choose.",
  category: "text",
  defaultSize: { w: 720, h: 240 },
  isPro: false,
  settingsSchema: textConfigSchema,
  dataNeeds: () => [],
  sizing: { mode: "fixed", userToggleable: true, minFontSize: 8, maxFontSize: 400 },
  /** The first line, shortened — what the layers panel calls it. */
  instanceLabel: (config) => {
    const first = (config.text ?? "").split("\n").find((line) => line.trim())?.trim() ?? "";
    return first.length > 32 ? `${first.slice(0, 31)}…` : first || "Text";
  },
};
