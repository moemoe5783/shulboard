import type { CSSProperties } from "react";
import { z } from "zod";
import { BOARD_FONTS, boardLength, type BoardFont } from "@/lib/board-theme";

/*
 * Per-widget appearance — the design/appearance controls EVERY widget carries:
 * a background box with its own transparency, corner radius, padding, a border,
 * a drop shadow, a text colour, a font, and an optional header (a title above
 * the widget, like "Zmanim" over the zmanim table). The fields, their defaults,
 * how they become CSS, and the ready-made frame presets all live here once, and
 * the properties panel renders them generically for every widget
 * (components/editor/AppearanceControls.tsx) rather than each Settings.tsx
 * repeating them.
 *
 * THESE ARE BOARD CONTENT, NOT CHROME. design.md §1b: a board is a
 * user-authored artifact and its content may use any colour, radius or font the
 * shul chooses — so `background`, `textColor` and `borderColor` are free CSS
 * colour strings (a hex a gabbai picked), not the named tokens the dashboard
 * chrome is restricted to. The no-raw-hex rule governs the application
 * interface, not what a shul puts on its board.
 *
 * Every default is the current behaviour: no background, full opacity, inherited
 * text colour and font, no padding, no radius, no border, no shadow, no header.
 * So a widget that spreads these fields and a document written before they
 * existed both render exactly as they did.
 */

/** The board faces plus "inherit" — the widget's own face, or the board's.
 *  The keys are lib/board-theme.ts's own BOARD_FONTS vocabulary. */
export const widgetFontSchema = z
  .enum([
    "inherit",
    "assistant",
    "heebo",
    "rubik",
    "alef",
    "secularOne",
    "sefarim",
    "davidLibre",
    "miriamLibre",
    "suezOne",
    "system",
  ])
  .default("inherit");
export type WidgetFont = z.infer<typeof widgetFontSchema>;

/** The style fields a widget spreads into its config schema. */
export const widgetStyleFields = {
  /** A CSS colour for the widget's background box, or "" for none
   *  (transparent — the board shows through). Free-form: board content. */
  background: z.string().max(64).default(""),
  /** The background's opacity, 0–100. Only meaningful with a background; a
   *  translucent panel over a photo is the point. */
  backgroundOpacity: z.number().min(0).max(100).default(100),
  /** A CSS colour for the widget's text, or "" to inherit the board's ink. */
  textColor: z.string().max(64).default(""),
  /** The widget's font, or "inherit" to use the board's. */
  font: widgetFontSchema,
  /**
   * Inner padding, as a MULTIPLE of the widget's own text size — not absolute
   * board units. 0.5 means "half the type size". This is what makes the frame
   * scale with the content: a size-14 zmanim gets ~7 units of padding, a
   * size-100 title gets ~50, from the same 0.5. An absolute default looked
   * enormous on small widgets and cramped on large ones.
   */
  padding: z.number().min(0).max(3).default(0),
  /** Background corner radius, in board design units (geometric, not tied to
   *  the text size — a rounded corner reads the same whatever the type). */
  radius: z.number().min(0).max(400).default(0),
  /** Border thickness, in board design units. 0 is no border. */
  borderWidth: z.number().min(0).max(80).default(0),
  /** A CSS colour for the border, or "" (falls back to the text colour). */
  borderColor: z.string().max(64).default(""),
  /** A soft drop shadow, so a frame reads as floating above the board. Board
   *  content, so design.md's "shadows only on chrome that floats" does not
   *  apply — a shul may give its own panel a shadow. */
  shadow: z.boolean().default(false),
  /** An optional header shown above the widget — "" for none. */
  title: z.string().max(120).default(""),
  /** The header's size, as a MULTIPLE of the widget's own text size (like
   *  `padding`). 1.3 means "a bit larger than the body". Relative so the header
   *  stays in proportion whatever type size the widget is set to. */
  titleSize: z.number().min(0.3).max(4).default(1.3),
} as const;

/** The subset of a widget's config these controls read and write. */
export type WidgetStyleConfig = {
  background: string;
  backgroundOpacity: number;
  textColor: string;
  font: WidgetFont;
  padding: number;
  radius: number;
  borderWidth: number;
  borderColor: string;
  shadow: boolean;
  title: string;
  titleSize: number;
};

/**
 * A ready-made frame — the "predesigned text boxes designed to look nice" a
 * gabbai picks instead of dialing in a background, radius and padding by hand.
 * Each is just a patch over the style fields, applied on click; the gabbai can
 * then adjust any of it. `swatch` is the CSS the panel paints its preview chip
 * with, so the choice is visual rather than a list of words.
 *
 * COLOURS ARE LITERAL, and that is correct here — board content, not chrome
 * (design.md §1b). The one that touches nothing visual is "None", which is how
 * a widget goes back to no frame at all.
 */
export type FramePreset = {
  id: string;
  label: string;
  patch: Partial<WidgetStyleConfig>;
  swatch: CSSProperties;
};

// A frame's padding is a MULTIPLE of the text size (widgets/style.ts), so one
// value looks right on a size-14 zmanim and a size-100 title alike.
const FRAME_PADDING = 0.5;

export const FRAME_PRESETS: FramePreset[] = [
  {
    id: "none",
    label: "None",
    patch: { background: "", backgroundOpacity: 100, padding: 0, radius: 0, borderWidth: 0, shadow: false },
    swatch: { background: "transparent", border: "1px dashed rgba(242,244,243,0.3)" },
  },
  {
    id: "card",
    label: "Card",
    patch: {
      background: "#ffffff",
      backgroundOpacity: 100,
      textColor: "#1a1a1a",
      padding: FRAME_PADDING,
      radius: 14,
      borderWidth: 0,
      shadow: true,
    },
    swatch: { background: "#ffffff", borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.35)" },
  },
  {
    id: "night",
    label: "Night",
    patch: {
      background: "#10141a",
      backgroundOpacity: 100,
      textColor: "#f4f5f7",
      padding: FRAME_PADDING,
      radius: 14,
      borderWidth: 0,
      shadow: false,
    },
    swatch: { background: "#10141a", borderRadius: "4px" },
  },
  {
    id: "warm",
    label: "Warm",
    patch: {
      background: "#f6efe1",
      backgroundOpacity: 100,
      textColor: "#35291a",
      padding: FRAME_PADDING,
      radius: 12,
      borderWidth: 0,
      shadow: true,
    },
    swatch: { background: "#f6efe1", borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.35)" },
  },
  {
    id: "ocean",
    label: "Ocean",
    patch: {
      background: "#12314a",
      backgroundOpacity: 100,
      textColor: "#eaf2f8",
      padding: FRAME_PADDING,
      radius: 14,
      borderWidth: 0,
      shadow: false,
    },
    swatch: { background: "#12314a", borderRadius: "4px" },
  },
  {
    id: "glass",
    label: "Glass",
    patch: {
      background: "#0b0f14",
      backgroundOpacity: 45,
      textColor: "#ffffff",
      padding: FRAME_PADDING,
      radius: 16,
      borderWidth: 1,
      borderColor: "#ffffff",
      shadow: false,
    },
    swatch: { background: "rgba(11,15,20,0.45)", borderRadius: "5px", border: "1px solid rgba(255,255,255,0.6)" },
  },
  {
    id: "outline",
    label: "Outline",
    patch: {
      background: "",
      backgroundOpacity: 100,
      padding: FRAME_PADDING,
      radius: 12,
      borderWidth: 3,
      borderColor: "currentColor",
      shadow: false,
    },
    swatch: { background: "transparent", borderRadius: "4px", border: "2px solid rgba(242,244,243,0.7)" },
  },
];

/**
 * Read the style subset off a widget's raw config, filling every default.
 *
 * The board document stores config as a plain record (lib/board-doc.ts does not
 * re-validate it against each widget's schema), so a board saved before these
 * fields existed has none of them. This is the one place that gap is closed —
 * BoardRenderer.WidgetFrame calls it for every widget, present or old — so a
 * document from before the appearance system renders exactly as it did, with no
 * frame, and every field has a concrete value the CSS builder can trust.
 */
export function normalizeWidgetStyle(config: Record<string, unknown>): WidgetStyleConfig {
  const str = (key: string) => (typeof config[key] === "string" ? (config[key] as string) : "");
  const num = (key: string, fallback: number) =>
    typeof config[key] === "number" && Number.isFinite(config[key]) ? (config[key] as number) : fallback;
  const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
  const font = config.font;
  return {
    background: str("background"),
    backgroundOpacity: clamp(num("backgroundOpacity", 100), 0, 100),
    textColor: str("textColor"),
    font: (typeof font === "string" && font in BOARD_FONTS ? font : "inherit") as WidgetFont,
    // padding and titleSize are ratios of the text size now (see the schema).
    // Clamp on read so a document written when they were absolute board units
    // (a padding of 28, a titleSize of 40) is bounded to something sane rather
    // than rendering a frame with 28× the type size of padding.
    padding: clamp(num("padding", 0), 0, 3),
    radius: num("radius", 0),
    borderWidth: num("borderWidth", 0),
    borderColor: str("borderColor"),
    shadow: config.shadow === true,
    title: str("title"),
    titleSize: clamp(num("titleSize", 1.3), 0.3, 4),
  };
}

/** #rgb or #rrggbb -> {r,g,b}, or null for anything else (a named colour, a
 *  gradient) — in which case the caller keeps the string as-is. */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (full) {
    return { r: parseInt(full[1], 16), g: parseInt(full[2], 16), b: parseInt(full[3], 16) };
  }
  return null;
}

/** A background colour composed with its opacity. Full opacity (or a colour
 *  this can't parse) returns the string untouched; otherwise it becomes rgba. */
export function composeBackground(color: string, opacityPct: number): string {
  if (!color || opacityPct >= 100) return color;
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  const alpha = Math.max(0, Math.min(100, opacityPct)) / 100;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * The style for a widget's outer frame — the element that carries the
 * background, padding, radius, border, shadow, colour and font, and fills the
 * widget's box. It is a flex column so an optional header can sit above the
 * content (BoardRenderer.WidgetFrame lays that out).
 *
 * `height`/`width`/`boxSizing` are always set so the frame fills the widget's
 * positioned box and its padding insets the content (rather than growing the
 * box); in `hug` mode the box is auto-height, where a percentage height
 * resolves to the content height, so this stays correct there too.
 *
 * The visual properties are set only when chosen, so an unstyled widget's frame
 * is a transparent, padding-less flex pass-through that changes nothing about
 * how it renders.
 */
export function widgetStyle(
  config: WidgetStyleConfig,
  canvasWidth: number,
  referenceSize: number,
  /**
   * The widget's own box, in design units, so padding can be capped against it.
   * `height` is `Infinity` in `hug` mode (the box grows to fit, so there is no
   * fixed height to consume). Omitted only by callers with no box to measure.
   */
  box?: { width: number; height: number },
): CSSProperties {
  const style: CSSProperties = {
    height: "100%",
    width: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  };

  if (config.background) style.backgroundColor = composeBackground(config.background, config.backgroundOpacity);
  if (config.textColor) style.color = config.textColor;
  if (config.font !== "inherit") style.fontFamily = BOARD_FONTS[config.font as BoardFont];
  // padding is a multiple of the widget's own text size (referenceSize is that
  // size, in design units), so the frame scales with the content.
  //
  // CAPPED AGAINST THE BOX, because referenceSize is `config.size`, which in a
  // fit-mode widget is decoupled from the actual box: a box dragged small while
  // config.size stays large (or an old size on a small box) would otherwise let
  // padding consume the whole box, collapsing the content area to zero. A
  // fit-mode Renderer that then measures a zero-width box freezes at its last
  // type size — the "defaults to 400 and won't change" report. The cap only
  // ever bites in that degenerate case; at normal sizes the relative padding is
  // far under it, so ordinary boards are unchanged.
  if (config.padding > 0) {
    let pad = config.padding * referenceSize;
    if (box) pad = Math.min(pad, MAX_FRAME_PADDING_FRACTION * Math.min(box.width, box.height));
    style.padding = boardLength(pad, canvasWidth);
  }
  if (config.radius > 0) style.borderRadius = boardLength(config.radius, canvasWidth);
  if (config.borderWidth > 0) {
    style.border = `${boardLength(config.borderWidth, canvasWidth)} solid ${config.borderColor || "currentColor"}`;
  }
  if (config.shadow) style.boxShadow = "0 0.4cqw 1.6cqw rgba(0, 0, 0, 0.28)";

  return style;
}

/**
 * The widget's own text size in design units, used as the reference the
 * relative padding and header size scale against. Board-content widgets store
 * it as `config.size`; a widget without one (media) falls back to a neutral
 * default so its frame still has sensible proportions.
 */
export const DEFAULT_REFERENCE_SIZE = 32;

export function referenceSizeOf(config: Record<string, unknown>): number {
  const size = config.size;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : DEFAULT_REFERENCE_SIZE;
}

/**
 * The most of a box each side's padding may take — so the two sides together
 * never exceed 60% of the smaller box dimension and the content area can never
 * collapse to nothing. See `widgetStyle`'s padding note for why this matters
 * (a fit-mode widget freezes on a zero-size box). 0.3 leaves a comfortable
 * margin against the header, which is capped separately (`cappedHeaderSize`).
 */
export const MAX_FRAME_PADDING_FRACTION = 0.3;

/** The most of the box height the header (its own line) may take. With padding
 *  capped at 0.3 each side, this leaves the content area positive even when both
 *  are maxed: 2×0.3 + 0.3 = 0.9 of the height, so ≥10% remains for the table. */
export const MAX_FRAME_HEADER_FRACTION = 0.3;

/**
 * The header's design-unit size, capped against the box height so a header on a
 * fit-mode widget with a large `config.size` on a short box cannot consume the
 * whole box (same decoupling as padding — see `widgetStyle`). `boxHeight` is
 * `Infinity` in `hug` mode, where the box grows to fit and there is nothing to
 * consume, so the header is left uncapped there.
 */
export function cappedHeaderSize(titleSize: number, referenceSize: number, boxHeight: number): number {
  const header = titleSize * referenceSize;
  return Number.isFinite(boxHeight) ? Math.min(header, MAX_FRAME_HEADER_FRACTION * boxHeight) : header;
}
