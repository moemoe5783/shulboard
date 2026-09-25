import { boardBackgroundCss, type BoardBackground } from "./board-background";
import type { CSSProperties } from "react";
import type { BoardDoc } from "@/lib/board-doc";
import { catalogId, digitFallbackFor, fontInfo } from "@/lib/fonts";
import { TIME_FALLBACK_WEIGHT } from "@/lib/fonts/catalog";
import { DEFAULT_FONT, fontStack } from "@/lib/fonts/stack";
import { boardFontRoles } from "@/lib/fonts/roles";

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
 * face is added or dropped. The names are catalog ids (lib/fonts), plus the
 * handful boards were saved with before the catalog, which still resolve.
 */

/**
 * The faces widgets name directly: Frank Ruhl Libre for Hebrew dates, the
 * parsha and the daf — sefarim typography. Every other face comes from the
 * document, through lib/fonts/stack.ts.
 */
export const BOARD_FONTS = {
  sefarim: fontStack("frank-ruhl-libre"),
} as const;

const WEIGHT_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/**
 * For a face WITHOUT tabular figures (no tnum, measured at build time): its
 * widest digit at every weight from 100 to 900, as `--board-digit-<weight>` custom properties, in em.
 * Measured per weight — a variable face's digits widen as it gets bolder — and
 * filled in between: a variable face by straight-line interpolation, a static
 * face with the file the browser actually draws that weight with
 * (matchedWeight) — and held flat beyond them. Empty for a face with tnum, whose digits
 * `lining-nums tabular-nums` already lines up — every digit box is then `auto`
 * (widgets/Digits.tsx).
 */
export function digitWidthVars(font: string | undefined): Record<string, string> {
  // A face with old-style figures draws its times in the fallback at a fixed,
  // matched weight (numericFace, numericWeight), so the boxes are the
  // fallback's, at that weight, whatever step asks.
  const fixedWeight = numericWeight(font);
  const info = fontInfo(digitFallbackFor(font ?? DEFAULT_FONT) ?? font ?? DEFAULT_FONT);
  if (!info || info.measured.hasTabularNums) return {};
  const measured = Object.entries(info.measured.digitEm)
    .map(([weight, em]) => [Number(weight), em] as const)
    .sort((a, b) => a[0] - b[0]);
  if (measured.length === 0) return {};
  const variable = info.measured.variable;
  const at = (weight: number) => {
    if (weight <= measured[0][0]) return measured[0][1];
    const last = measured[measured.length - 1];
    if (weight >= last[0]) return last[1];
    const exact = measured.find(([w]) => w === weight);
    if (exact) return exact[1];
    // A static face has no weight in between: the browser draws the file CSS
    // font matching picks, so the box is that file's widest digit.
    if (!variable) return measured.find(([w]) => w === matchedWeight(weight, measured.map(([w]) => w)))![1];
    const upper = measured.findIndex(([w]) => w >= weight);
    const [w0, e0] = measured[upper - 1];
    const [w1, e1] = measured[upper];
    return e0 + ((e1 - e0) * (weight - w0)) / (w1 - w0);
  };
  const vars: Record<string, string> = {};
  for (const weight of WEIGHT_STEPS) vars[`--board-digit-${weight}`] = `${Math.round(at(fixedWeight ?? weight) * 10000) / 10000}em`;
  return vars;
}

/**
 * The weight a browser draws `wanted` at from a static face's weights — CSS
 * font matching: an exact weight; for 400–500, heavier up to 500, then
 * lighter, then heavier; below 400, lighter then heavier; above 500, heavier
 * then lighter.
 */
export function matchedWeight(wanted: number, available: readonly number[]): number {
  const sorted = [...available].sort((a, b) => a - b);
  if (sorted.includes(wanted)) return wanted;
  const lighter = sorted.filter((w) => w < wanted).reverse();
  const heavier = sorted.filter((w) => w > wanted);
  if (wanted >= 400 && wanted <= 500) {
    const upTo500 = heavier.filter((w) => w <= 500);
    return upTo500[0] ?? lighter[0] ?? heavier[0];
  }
  if (wanted < 400) return lighter[0] ?? heavier[0];
  return heavier[0] ?? lighter[0];
}

/** The digit box width for text at a weight: its face's widest digit when the
 *  face needs boxes, else `auto`. */
export function digitWidthVar(weight: number): string {
  const step = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  return `var(--board-digit-${step}, auto)`;
}

/**
 * The face a time, a zman or a countdown is set in: the text's own, in its
 * lining figures (widgets/Digits.tsx).
 *
 * THE ONE EXCEPTION: a face whose figures are old-style with no lining set
 * (Marcellus, Pinyon Script, Parisienne, Suez One — and Alef, kept for boards
 * that use it) would draw a column of times at uneven heights. So the WHOLE
 * time — digits, colon, AM/PM — is set in the matched fallback, Frank Ruhl
 * Libre for a serif and Heebo otherwise, at a weight chosen to match the face
 * (numericWeight). Only in the times; everywhere else the face keeps its own
 * figures.
 */
export function numericFace(font: string | undefined, hebrew?: string | null): string {
  const fallback = digitFallbackFor(font ?? DEFAULT_FONT);
  return fallback ? fontStack(fallback, hebrew) : fontStack(font, hebrew);
}

/** The weight a time is drawn at when it's set in the fallback — tuned per
 *  face (lib/fonts/catalog.ts, TIME_FALLBACK_WEIGHT); null otherwise, leaving
 *  a time at its widget's own weight. */
export function numericWeight(font: string | undefined): number | null {
  const id = catalogId(font ?? DEFAULT_FONT);
  if (!id || !digitFallbackFor(id)) return null;
  return TIME_FALLBACK_WEIGHT[id] ?? null;
}

/** What a time's weight is, for a Renderer: its own semibold, or the matched
 *  weight when the time is in the fallback (set on the board root and the
 *  widget frame as `--board-numeric-weight`). */
export const NUMERIC_WEIGHT = "var(--board-numeric-weight, 600)";

/**
 * What a clock time, a zman or a countdown sets its digits in. The board root
 * and a widget frame with its own font each set `--board-numeric-font`
 * (`numericFace`), so a Renderer reads it without being told the font — its
 * props stay `{config, canvas}`.
 */
export const NUMERIC_FONT = `var(--board-numeric-font, inherit)`;

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
 *
 * OLDER TV BROWSERS HAVE NO `cqw`. Container query units arrived in Chromium
 * 105 (2022), and plenty of smart TVs run something older. There the value is
 * invalid and dropped, and the size silently becomes whatever the element
 * inherits — a caption that ignores its size setting while everything that
 * fits itself by measuring still looks right. So the length goes through
 * `--board-unit`, one design unit in pixels, which the board root sets only
 * on a browser without `cqw` (components/board/BoardRenderer.tsx); everywhere
 * else the variable is unset and the `cqw` fallback is what renders.
 */
export const BOARD_UNIT_VAR = "--board-unit";
/** One percent of the board's width in pixels, for the same fallback — for
 *  a length written as a share of the board rather than in design units. */
export const BOARD_CQW_VAR = "--board-cqw";

/** `n` percent of the board's width (n `cqw`), with the same fallback. */
export function boardPercent(n: number): string {
  return `calc(${n} * var(${BOARD_CQW_VAR}, 1cqw))`;
}

export function boardLength(designUnits: number, canvasWidth: number): string {
  return `calc(${designUnits} * var(${BOARD_UNIT_VAR}, ${100 / canvasWidth}cqw))`;
}

/** Whether this browser has container query units. True where it can't be
 *  asked (the server), which is the modern case. */
export function supportsContainerUnits(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return true;
  return CSS.supports("width", "1cqw");
}

/** Reads better at a call site setting a font size. Same conversion. */
export const boardFontSize = boardLength;

/** The style the board root carries, from the document's own theme. */
export function boardRootStyle(doc: BoardDoc): CSSProperties {
  const theme = doc.themeOverrides as { ink?: string; background?: string };
  // The board root carries the body font; a heading, accent or quote is set on
  // the element that uses it (widgets/style.ts).
  const { font, hebrew } = boardFontRoles(doc.themeOverrides).body;
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
    fontFamily: fontStack(font, hebrew),
    ["--board-numeric-font" as string]: numericFace(font, hebrew),
    ...(numericWeight(font) ? { ["--board-numeric-weight" as string]: numericWeight(font) } : {}),
    ...digitWidthVars(font),
    color: BOARD_COLORS[ink] ?? BOARD_COLORS.ink,
    backgroundColor: BOARD_COLORS[background] ?? BOARD_COLORS.surface,
    ...(custom ? { background: `${custom}`, backgroundColor: undefined } : {}),
  };
}
