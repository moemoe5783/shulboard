import { BACKGROUND_LIBRARY, type LibraryBackground } from "./background-library.ts";

/*
 * Backgrounds, for the board itself and for any widget's frame.
 *
 * ONE STRING VALUE, stored the same way in the board document and a widget's
 * config:
 *   "#1b2a2e"                          a colour
 *   "linear-gradient(…)" / "radial-…"  a gradient this module built
 *   "library:<id>"                     a picture from the library (board only)
 *   "image:<assetId>"                  a photo from the shul's Media (board only)
 * `backgroundCss` turns any of them into CSS; `backgroundTone` says whether it
 * reads as light or dark, which is how picking a dark background can switch the
 * board's text to light so nothing becomes unreadable.
 *
 * PICTURES ARE FOR THE BOARD. A widget's box takes a colour or a gradient; its
 * ready-made looks are the frame presets in widgets/style.ts. A picture value
 * that reaches a widget (an old config) draws nothing rather than a photo in a
 * card.
 *
 * A picture needs a URL as well as its value: a library picture's is in the
 * catalogue (lib/background-library.ts), and a Media photo's is the media-proxy
 * path the editor stores beside the value as `src` and the bundle build
 * re-resolves (lib/bundle/assemble.ts), exactly like the Image widget.
 *
 * BOARD CONTENT, NOT CHROME (design.md §1b): these are what a shul puts on its
 * screens, so colours here are literal values.
 */

export type BackgroundTone = "light" | "dark";

/** The board document's `background` record. */
export type BoardBackground = {
  value?: string;
  /** A Media photo's proxy path (for "image:" values). */
  src?: string;
  /** How much to darken a picture, 0–80 (%), so text on it stays readable. */
  dim?: number;
  /** A picture's measured average luminance, 0–1, so changing `dim` can
   *  re-derive the tone without measuring again. */
  luminance?: number;
};

export const MAX_BACKGROUND_DIM = 80;

export function libraryBackground(value: string): LibraryBackground | null {
  if (!value.startsWith("library:")) return null;
  const id = value.slice("library:".length);
  return BACKGROUND_LIBRARY.find((entry) => entry.id === id) ?? null;
}

/** The asset id an "image:" value points at, or null. */
export function backgroundAssetId(value: string): string | null {
  return value.startsWith("image:") && value.length > "image:".length ? value.slice("image:".length) : null;
}

// ---- gradients ----------------------------------------------------------------

export type GradientStop = { color: string; at: number };
export type GradientSpec = { type: "linear" | "radial"; angle: number; stops: GradientStop[] };

export const DEFAULT_GRADIENT: GradientSpec = {
  type: "linear",
  angle: 160,
  stops: [
    { color: "#0b1a33", at: 0 },
    { color: "#1d4fa3", at: 100 },
  ],
};

export function gradientCss(spec: GradientSpec): string {
  const stops = spec.stops.map((stop) => `${stop.color} ${Math.round(stop.at)}%`).join(", ");
  return spec.type === "radial" ? `radial-gradient(circle at 50% 50%, ${stops})` : `linear-gradient(${Math.round(spec.angle)}deg, ${stops})`;
}

/** Read back a gradient `gradientCss` wrote — the editor's round trip. Null for
 *  anything else (a preset, a colour, a gradient from somewhere else). */
export function parseGradient(css: string): GradientSpec | null {
  const match = /^(linear|radial)-gradient\((.*)\)$/.exec(css.trim());
  if (!match) return null;
  const [, type, body] = match;
  let rest = body;
  let angle = 180;
  if (type === "linear") {
    const head = /^(\d+(?:\.\d+)?)deg,\s*/.exec(rest);
    if (!head) return null;
    angle = Number(head[1]);
    rest = rest.slice(head[0].length);
  } else {
    if (!rest.startsWith("circle at 50% 50%, ")) return null;
    rest = rest.slice("circle at 50% 50%, ".length);
  }
  const stops: GradientStop[] = [];
  for (const part of rest.split(/,\s*/)) {
    const stop = /^(#[0-9a-f]{6})\s+(\d+(?:\.\d+)?)%$/i.exec(part.trim());
    if (!stop) return null;
    stops.push({ color: stop[1].toLowerCase(), at: Number(stop[2]) });
  }
  return stops.length >= 2 ? { type: type as GradientSpec["type"], angle, stops } : null;
}

// ---- resolving a value ---------------------------------------------------------

export type BackgroundKind = "none" | "color" | "gradient" | "image";

export function backgroundKind(value: string): BackgroundKind {
  if (!value) return "none";
  if (value.startsWith("library:") || value.startsWith("image:")) return "image";
  if (/^(linear|radial)-gradient\(/.test(value)) return "gradient";
  // The drawn presets this replaced ("preset:…") are gone; one stored before
  // then is no background rather than an invalid colour.
  if (value.startsWith("preset:")) return "none";
  return "color";
}

/** The picture URL a value draws, or null (not a picture, or unresolvable). */
export function backgroundImageSrc(background: BoardBackground): string | null {
  const value = background.value ?? "";
  const library = libraryBackground(value);
  if (library) return library.src;
  if (backgroundAssetId(value) && typeof background.src === "string" && background.src) return background.src;
  return null;
}

/** Colours and gradients only — a widget frame's background. */
export function backgroundCss(value: string): string | undefined {
  const kind = backgroundKind(value);
  return kind === "color" || kind === "gradient" ? value : undefined;
}

/** The board's background as CSS, pictures included. The picture covers the
 *  board (cropping the edges rather than stretching), with an optional dark
 *  veil over it, on a dark ground so the moment before it loads isn't white. */
export function boardBackgroundCss(background: BoardBackground): string | undefined {
  const value = background.value ?? "";
  if (backgroundKind(value) !== "image") return backgroundCss(value);
  const src = backgroundImageSrc(background);
  if (!src) return undefined;
  const dim = clampDim(background.dim);
  const veil = dim > 0 ? `linear-gradient(rgba(0, 0, 0, ${dim / 100}), rgba(0, 0, 0, ${dim / 100})), ` : "";
  return `${veil}url("${src.replace(/"/g, "%22")}") center / cover no-repeat #10141a`;
}

export function clampDim(dim: unknown): number {
  return typeof dim === "number" && Number.isFinite(dim) ? Math.max(0, Math.min(MAX_BACKGROUND_DIM, Math.round(dim))) : 0;
}

function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((part) => {
    const c = parseInt(part, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whether text on this background should be light or dark. Null for none, or
 *  a value whose colours can't be read. */
export function backgroundTone(value: string): BackgroundTone | null {
  const kind = backgroundKind(value);
  if (kind === "none") return null;
  // A library picture's tone is measured when it's added; a Media photo's is
  // measured in the editor when it's picked (it isn't known here).
  if (kind === "image") return libraryBackground(value)?.tone ?? null;
  const colors = kind === "gradient" ? (parseGradient(value)?.stops.map((stop) => stop.color) ?? []) : [value];
  const lums = colors.map(luminance).filter((l): l is number => l !== null);
  if (lums.length === 0) return null;
  const average = lums.reduce((sum, l) => sum + l, 0) / lums.length;
  // 0.18 is roughly where white and near-black text have equal contrast.
  return average > 0.18 ? "light" : "dark";
}

/** The tone of a picture whose average relative luminance (0–1) was measured,
 *  after `dim` percent of black is laid over it. */
export function toneForLuminance(luminance: number, dim = 0): BackgroundTone {
  return luminance * (1 - clampDim(dim) / 100) > 0.18 ? "light" : "dark";
}
