import type { CSSProperties } from "react";
import { z } from "zod";
import { BOARD_FONTS, boardLength, type BoardFont } from "@/lib/board-theme";

/*
 * Per-widget appearance: a background box, its padding and corner radius, a
 * text colour, and a font — shared by the widgets that offer them (zmanim,
 * candle lighting) so the fields, their defaults, and how they become CSS all
 * live once.
 *
 * THESE ARE BOARD CONTENT, NOT CHROME. design.md §1b: a board is a
 * user-authored artifact and its content may use any colour, radius or font
 * the shul chooses — so `background` and `textColor` are free CSS colour
 * strings (a hex a gabbai picked), not the named tokens the dashboard chrome
 * is restricted to. The no-raw-hex rule governs the application interface, not
 * what a shul puts on its board.
 *
 * Every default is the current behaviour: no background, inherited text colour
 * and font, no padding. So a widget that spreads these fields and a document
 * written before they existed both render exactly as they did.
 */

/** The three board faces plus "inherit" — the widget's own font, or the
 *  board's. `boardFont` here is the same vocabulary lib/board-theme.ts uses. */
export const widgetFontSchema = z.enum(["inherit", "assistant", "sefarim", "system"]).default("inherit");
export type WidgetFont = z.infer<typeof widgetFontSchema>;

/** The style fields a widget spreads into its config schema. */
export const widgetStyleFields = {
  /** A CSS colour for the widget's background box, or "" for none
   *  (transparent — the board shows through). Free-form: board content. */
  background: z.string().max(64).default(""),
  /** A CSS colour for the widget's text, or "" to inherit the board's ink. */
  textColor: z.string().max(64).default(""),
  /** The widget's font, or "inherit" to use the board's. */
  font: widgetFontSchema,
  /** Inner padding, in board design units. Only visible with a background. */
  padding: z.number().min(0).max(400).default(0),
  /** Background corner radius, in board design units. */
  radius: z.number().min(0).max(400).default(0),
} as const;

/** The subset of a widget's config these controls read and write. */
export type WidgetStyleConfig = {
  background: string;
  textColor: string;
  font: WidgetFont;
  padding: number;
  radius: number;
};

/**
 * The style for a widget's outer frame — the element that carries the
 * background, padding and radius and fills the widget's box.
 *
 * `height`/`width`/`boxSizing` are always set so the frame fills the widget's
 * positioned box and its padding insets the content (rather than growing the
 * box); in `hug` mode the box is auto-height, where a percentage height
 * resolves to the content height, so this stays correct there too.
 *
 * The visual properties are set only when chosen, so an unstyled widget's
 * frame is a transparent, padding-less pass-through that changes nothing about
 * how it renders.
 */
export function widgetStyle(config: WidgetStyleConfig, canvasWidth: number): CSSProperties {
  const style: CSSProperties = { height: "100%", width: "100%", boxSizing: "border-box" };

  if (config.background) style.backgroundColor = config.background;
  if (config.textColor) style.color = config.textColor;
  if (config.font !== "inherit") style.fontFamily = BOARD_FONTS[config.font as BoardFont];
  if (config.padding > 0) style.padding = boardLength(config.padding, canvasWidth);
  if (config.radius > 0) style.borderRadius = boardLength(config.radius, canvasWidth);

  return style;
}
