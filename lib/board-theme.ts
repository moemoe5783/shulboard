import { boardBackgroundCss, type BoardBackground } from "./board-background";
import type { CSSProperties } from "react";
import type { BoardDoc } from "@/lib/board-doc";

/*
 * How a board document turns into type and colour.
 *
 * TWO FONT NAMESPACES, AND THEY STAY SEPARATE. The dashboard opts into
 * Assistant with `font-ui`. The board does not inherit that and must not: a
 * board's type comes from its document, because it is the shul's design and it
 * has to render the same in the editor and on the wall. A document that chooses
 * Assistant gets Assistant — chosen, not inherited, which is the whole
 * distinction CLAUDE.md is drawing.
 *
 * The document stores a NAME, not a font stack. Storing the stack would put CSS
 * in the database, and every board ever saved would need rewriting the day a
 * face is added or dropped.
 */

export const BOARD_FONTS = {
  /** Bilingual Hebrew and Latin. The sensible default for a board that mixes. */
  assistant: "var(--type-ui)",
  /** Sefarim typography, and the only face here with tabular figures — which is
   *  what makes a column of zmanim line up. */
  sefarim: "var(--type-sefarim)",
  /** Clean bilingual sans — a lighter, more geometric alternative to Assistant. */
  heebo: "var(--type-heebo)",
  /** Rounded bilingual sans, friendly. */
  rubik: "var(--type-rubik)",
  /** Plain bilingual sans, a touch of warmth. */
  alef: "var(--type-alef)",
  /** Bilingual serif — a lighter sefarim alternative to Frank Ruhl Libre. */
  davidLibre: "var(--type-david-libre)",
  /** Bilingual slab, strong at large sizes — good for headers. */
  miriamLibre: "var(--type-miriam-libre)",
  /** Heavy bilingual display serif — a title face, read across a room. */
  suezOne: "var(--type-suez-one)",
  /** Bold bilingual display sans — a title face. */
  secularOne: "var(--type-secular-one)",
  /** Whatever the device has. Never the right answer for Hebrew. */
  system: "var(--type-neutral)",
} as const;

export type BoardFont = keyof typeof BOARD_FONTS;

/**
 * The faces whose digits are all one width (with `tabular-nums`), MEASURED
 * rather than assumed: 00000 against 11111 in a real browser, each face
 * confirmed loaded, spread 0.00px for these five. Assistant, Alef, Suez One
 * and Secular One have no tabular figures, so a clock set in them would jitter
 * as its digits change and a column of times wouldn't line up (design.md §3,
 * docs/sizing.md §4).
 */
export const TABULAR_FONTS: ReadonlySet<BoardFont> = new Set(["sefarim", "heebo", "rubik", "davidLibre", "miriamLibre"]);

/** The face numbers are set in for a chosen font: that font when its digits
 *  are one width, Frank Ruhl Libre when they aren't. */
export function numericFace(font: string | undefined): string {
  return font && TABULAR_FONTS.has(font as BoardFont) ? BOARD_FONTS[font as BoardFont] : BOARD_FONTS.sefarim;
}

/**
 * What a clock time, a zman or a countdown sets its digits in. The board root
 * and a widget frame with its own font each set `--board-numeric-font`
 * (`numericFace`), so a Renderer reads it without being told the font — its
 * props stay `{config, canvas}`.
 */
export const NUMERIC_FONT = `var(--board-numeric-font, ${BOARD_FONTS.sefarim})`;

/**
 * The board faces a widget may pick, in the order a font menu shows them —
 * a stable label per face. `sefarim` is spelled "Frank Ruhl Libre" here
 * because that is the name a gabbai recognises; the key is the document's
 * stable id (lib/board-theme.ts). "System" is last, an escape hatch rather
 * than a real choice for a board that carries Hebrew.
 */
export const BOARD_FONT_OPTIONS: { value: BoardFont; label: string }[] = [
  { value: "assistant", label: "Assistant" },
  { value: "heebo", label: "Heebo" },
  { value: "rubik", label: "Rubik" },
  { value: "alef", label: "Alef" },
  { value: "secularOne", label: "Secular One" },
  { value: "sefarim", label: "Frank Ruhl Libre" },
  { value: "davidLibre", label: "David Libre" },
  { value: "miriamLibre", label: "Miriam Libre" },
  { value: "suezOne", label: "Suez One" },
  { value: "system", label: "System" },
];

/**
 * Board colours, by name.
 *
 * Names rather than values for the same reason as the fonts, and because
 * CLAUDE.md forbids a raw colour outside lib/tokens.css. When a shul can pick
 * its own palette (§4d) this becomes a name plus an org-level definition of
 * what that name means; the documents already written keep working.
 */
export const BOARD_COLORS = {
  ink: "var(--ink)",
  paper: "var(--paper)",
  surface: "var(--surface)",
  verdigris: "var(--verdigris)",
} as const;

export type BoardColor = keyof typeof BOARD_COLORS;

/**
 * A length in design units, expressed so it scales with the board.
 *
 * `cqw` is a percentage of the board container's width, so a value of 72 design
 * units on a 1920 canvas becomes 3.75cqw and renders as 72px on a 1080p screen,
 * 24px in the editor at 33%, and 144px on a 4K wall. Nothing has to be told the
 * scale, which is what keeps the editor honestly WYSIWYG instead of
 * approximately so.
 *
 * This is why the board root sets `container-type: size` and nothing else may.
 */
export function boardLength(designUnits: number, canvasWidth: number): string {
  return `${(designUnits / canvasWidth) * 100}cqw`;
}

/** Reads better at a call site setting a font size. Same conversion. */
export const boardFontSize = boardLength;

/** The style the board root carries, from the document's own theme. */
export function boardRootStyle(doc: BoardDoc): CSSProperties {
  const theme = doc.themeOverrides as { font?: string; ink?: string; background?: string };

  const font = (theme.font ?? "assistant") as BoardFont;
  const ink = (theme.ink ?? "ink") as BoardColor;
  const background = (theme.background ?? "surface") as BoardColor;

  // The board's own background (lib/board-background.ts) — a colour, gradient
  // or picture — drawn over the theme's token colour, which stays as the
  // fallback beneath it.
  const custom = boardBackgroundCss((doc.background ?? {}) as BoardBackground);

  return {
    // A board is light-scheme wherever it's drawn: inside the editor's dark
    // chrome (which sets `color-scheme: dark` for its own controls) and on a
    // TV alike, so it renders the same in both (CLAUDE.md: one renderer).
    colorScheme: "only light",
    fontFamily: BOARD_FONTS[font] ?? BOARD_FONTS.assistant,
    ["--board-numeric-font" as string]: numericFace(font),
    color: BOARD_COLORS[ink] ?? BOARD_COLORS.ink,
    backgroundColor: BOARD_COLORS[background] ?? BOARD_COLORS.surface,
    ...(custom ? { background: `${custom}`, backgroundColor: undefined } : {}),
  };
}
