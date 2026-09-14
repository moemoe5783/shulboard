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

  return {
    fontFamily: BOARD_FONTS[font] ?? BOARD_FONTS.assistant,
    color: BOARD_COLORS[ink] ?? BOARD_COLORS.ink,
    backgroundColor: BOARD_COLORS[background] ?? BOARD_COLORS.surface,
  };
}
