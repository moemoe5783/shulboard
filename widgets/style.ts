import type { CSSProperties } from "react";
import { z } from "zod";
import { backgroundCss, backgroundKind } from "@/lib/board-background";
import { boardLength, digitWidthVars, numericFace, numericWeight } from "@/lib/board-theme";
import { boldWeight, catalogId, clampWeight, hebrewFont as hebrewFontById } from "@/lib/fonts";
import { fontStack } from "@/lib/fonts/stack";
import { isFontRole, resolveElementFont, type BoardFontRoles, type FontRole } from "@/lib/fonts/roles";

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

/** A catalog font id (lib/fonts) — or one of the names boards were saved with
 *  before the catalog — or "inherit" for the board's. A string rather than an
 *  enum so adding a face to the catalog is not a schema change for every
 *  stored document; an unknown name reads as "inherit". */
export const widgetFontSchema = z.string().max(64).default("inherit");
export type WidgetFont = string;

/** A stored Hebrew choice, read safely: "inherit", "auto", or a Hebrew font
 *  that exists; anything else is "inherit". */
export function readHebrewChoice(value: unknown): string {
  if (value === "auto") return "auto";
  return typeof value === "string" && hebrewFontById(value) ? value : "inherit";
}

/** The style fields a widget spreads into its config schema. */
export const widgetStyleFields = {
  /** The widget's background box: a colour or a gradient
   *  (lib/board-background.ts), or "" for none — the board shows through.
   *  Free-form: board content. Long enough for a three-stop gradient. */
  background: z.string().max(600).default(""),
  /** The background's opacity, 0–100. Only meaningful with a background; a
   *  translucent panel over a photo is the point. */
  backgroundOpacity: z.number().min(0).max(100).default(100),
  /** A CSS colour for the widget's text, or "" to inherit the board's ink. */
  textColor: z.string().max(64).default(""),
  /** The widget's font, or "inherit" to use the board's. */
  font: widgetFontSchema,
  /** The face the widget's Hebrew is drawn in: "inherit" for the board's
   *  choice, "auto" for the one matched to the widget's font
   *  (lib/fonts/stack.ts), or a Hebrew override font's id. */
  hebrewFont: z.string().max(64).default("inherit"),
  /** The weight the element's main text is drawn at, or 0 for its own default
   *  (regular body text, semibold titles). Clamped to what its face offers
   *  from its minimum up (lib/fonts, clampWeight) — never lighter. */
  fontWeight: z.number().int().min(0).max(900).default(0),
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
  /** How strong that shadow is, 0–100: 50 is the soft shadow every frame had
   *  before this was adjustable. */
  shadowStrength: z.number().min(0).max(100).default(50),
  /** Line spacing, as a multiple of each element's own (1 = as designed).
   *  The frame scales the tight and snug leadings every Renderer uses, so a
   *  zmanim table's rows, a title's lines and a caption all open up together. */
  lineSpacing: z.number().min(0.6).max(2.5).default(1),
  /** The space under the header, as a multiple of the header's size. */
  titleGap: z.number().min(0).max(2).default(0.35),
  /** Where the header sits: centred (as always), each line to its own
   *  language's start, or left or right. */
  titleAlign: z.enum(["center", "start", "left", "right"]).default("center"),
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
  hebrewFont: string;
  fontWeight: number;
  padding: number;
  radius: number;
  borderWidth: number;
  borderColor: string;
  shadow: boolean;
  shadowStrength: number;
  lineSpacing: number;
  titleGap: number;
  titleAlign: "center" | "start" | "left" | "right";
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
    font: typeof font === "string" && (catalogId(font) || isFontRole(font)) ? font : "inherit",
    hebrewFont: readHebrewChoice(config.hebrewFont),
    fontWeight: clamp(Math.round(num("fontWeight", 0)), 0, 900),
    // padding and titleSize are ratios of the text size now (see the schema).
    // Clamp on read so a document written when they were absolute board units
    // (a padding of 28, a titleSize of 40) is bounded to something sane rather
    // than rendering a frame with 28× the type size of padding.
    padding: clamp(num("padding", 0), 0, 3),
    radius: num("radius", 0),
    borderWidth: num("borderWidth", 0),
    borderColor: str("borderColor"),
    shadow: config.shadow === true,
    shadowStrength: clamp(num("shadowStrength", 50), 0, 100),
    lineSpacing: clamp(num("lineSpacing", 1), 0.6, 2.5),
    titleGap: clamp(num("titleGap", 0.35), 0, 2),
    titleAlign: (["center", "start", "left", "right"] as const).find((a) => a === config.titleAlign) ?? "center",
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
  /** The board's font roles, and which one this widget takes by default
   *  (lib/fonts/roles.ts). Omitted, the widget draws in whatever it inherits. */
  board?: { roles: BoardFontRoles; role: FontRole },
): CSSProperties {
  const style: CSSProperties = {
    height: "100%",
    width: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  };

  if (config.background) {
    // A plain colour honours the transparency slider; a gradient or library
    // preset is drawn as it is (its own layers carry any transparency).
    if (backgroundKind(config.background) === "color") {
      style.backgroundColor = composeBackground(config.background, config.backgroundOpacity);
    } else {
      style.background = backgroundCss(config.background);
    }
  }
  if (config.textColor) style.color = config.textColor;
  // Line spacing: the leadings Renderers use (Tailwind's leading-tight and
  // leading-snug read these), scaled — so their props stay {config, canvas}.
  if (config.lineSpacing !== 1) {
    const vars = style as Record<string, string>;
    vars["--leading-tight"] = String(Math.round(1.25 * config.lineSpacing * 1000) / 1000);
    vars["--leading-snug"] = String(Math.round(1.375 * config.lineSpacing * 1000) / 1000);
  }
  // The widget's font: its own, a role by name, or its role's default
  // (lib/fonts/roles.ts). Set only when it differs from the body font the
  // board root already carries, so an element following the body inherits it.
  if (board) {
    const { font, hebrew } = resolveElementFont(config.font, config.hebrewFont, board.role, board.roles);
    const body = board.roles.body;
    // The weights its text is drawn at, in what its face offers: regular and
    // bold (a face's own bold — lib/fonts, boldWeight) never below the face's
    // minimum, and the element's chosen weight, if it has one. Renderers read
    // them as CSS variables, so their props stay {config, canvas}.
    const vars = style as Record<string, string | number>;
    vars["--board-weight-regular"] = clampWeight(font, 400);
    vars["--board-weight-semibold"] = clampWeight(font, 600);
    vars["--board-weight-bold"] = boldWeight(font);
    vars["--board-weight-main"] = config.fontWeight > 0 ? clampWeight(font, config.fontWeight) : "initial";
    if (font !== body.font || hebrew !== body.hebrew) {
      style.fontFamily = fontStack(font, hebrew);
      // Numbers are set in the widget's own face (lib/board-theme.ts).
      (style as Record<string, string>)["--board-numeric-font"] = numericFace(font, hebrew);
      // The matched weight of a time set in the fallback, or back to the
      // widget's own (clearing a board-level one).
      (style as Record<string, string | number>)["--board-numeric-weight"] = numericWeight(font) ?? "initial";
      // Its own digit widths — or none, clearing the board's, when its face's
      // digits line up by themselves (widgets/Digits.tsx).
      const digits = digitWidthVars(font);
      for (const weight of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
        (style as Record<string, string>)[`--board-digit-${weight}`] = digits[`--board-digit-${weight}`] ?? "auto";
      }
    }
  }
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

  return style;
}

/**
 * What the widget's POSITIONED BOX carries, outside the frame above: the drop
 * shadow, and the same corner radius. The box clips its content
 * (overflow: hidden); a shadow on the frame inside it was clipped to the box's
 * square edges, so it vanished outside the widget and showed as dark wedges in
 * the rounded corners instead. An element's own shadow isn't clipped by its own
 * overflow, and a radius on the clipping box rounds the clip, so the shadow
 * follows the corners and nothing spills past them.
 */
export function widgetBoxStyle(config: WidgetStyleConfig, canvasWidth: number): CSSProperties {
  const style: CSSProperties = {};
  if (config.radius > 0) style.borderRadius = boardLength(config.radius, canvasWidth);
  const shadow = config.shadow ? frameShadow(config.shadowStrength) : undefined;
  if (shadow) style.boxShadow = shadow;
  return style;
}

/** The frame's shadow at a strength, 0–100. 50 is the original soft shadow;
 *  100 is twice as far, twice as soft and darker; 0 is none. */
export function frameShadow(strength: number): string | undefined {
  const s = Math.max(0, Math.min(100, strength)) / 50;
  if (s <= 0) return undefined;
  return `0 ${(0.4 * s).toFixed(3)}cqw ${(1.6 * s).toFixed(3)}cqw rgba(0, 0, 0, ${Math.min(0.6, 0.28 * s).toFixed(3)})`;
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
