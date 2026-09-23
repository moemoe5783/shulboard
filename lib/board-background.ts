/*
 * Backgrounds — for the board itself and for any widget's frame — and the
 * library of ready-made ones.
 *
 * ONE VALUE, THREE KINDS, stored as a single string so the board document and
 * a widget config carry it the same way:
 *   "#1b2a2e"                         a colour
 *   "linear-gradient(…)" / "radial-…" a gradient this module built
 *   "preset:<id>"                     one of the library below
 * `backgroundCss` turns any of them into CSS; `backgroundTone` says whether it
 * reads as light or dark, which is how picking a dark background can switch the
 * board's text to light so nothing becomes unreadable.
 *
 * THE LIBRARY IS DRAWN, NOT PHOTOGRAPHED. Every preset is layered CSS gradients
 * and small SVG patterns/textures, so it is razor-sharp on a 4K lobby screen,
 * costs a few hundred bytes rather than megabytes, needs no caching to work
 * offline, and carries no image licence. Patterns are sized in PERCENT of the
 * box, so a pattern keeps its scale relative to the board at every resolution
 * (the board root can't use cqw on itself — it IS the size container).
 *
 * BOARD CONTENT, NOT CHROME (design.md §1b): these are colours a shul puts on
 * its screens, so they're literal values. They were chosen for what a shul
 * board is — read from across a room, often under bright lights, with text on
 * top — which is why most are deep, low-contrast grounds or calm light ones,
 * and every pattern is faint.
 */

export type BackgroundTone = "light" | "dark";

export type BackgroundPreset = {
  id: string;
  name: string;
  category: string;
  tone: BackgroundTone;
  /** The CSS `background` shorthand — one or more layers. */
  css: string;
};

// ---- building blocks ---------------------------------------------------------

function svg(markup: string, width: number, height: number): string {
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${markup}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(doc)}")`;
}

/** A repeating SVG tile over a base, the tile `size` percent of the box wide. */
function pattern(markup: string, width: number, height: number, size: number, base: string): string {
  return `${svg(markup, width, height)} 0 0 / ${size}% auto repeat, ${base}`;
}

/** Fine stone/paper grain: fractal noise, stitched so the tile has no seams. */
function grain(opacity: number, frequency = 0.9): string {
  return svg(
    `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.35 0 0 0 0 0.3 0 0 0 0 0.22 0 0 0 ${opacity} 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/>`,
    300,
    300,
  );
}

/** A starfield tile: a fixed scatter of small dots, so every board draws the same sky. */
function stars(count: number, seed: number, color = "#ffffff"): string {
  let s = seed;
  const next = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  let dots = "";
  for (let i = 0; i < count; i += 1) {
    const r = next() < 0.85 ? 0.6 + next() * 0.6 : 1.3 + next() * 0.8;
    dots += `<circle cx="${(next() * 400).toFixed(1)}" cy="${(next() * 400).toFixed(1)}" r="${r.toFixed(2)}" fill="${color}" opacity="${(0.35 + next() * 0.65).toFixed(2)}"/>`;
  }
  return svg(dots, 400, 400);
}

const star6 = (stroke: string, opacity: number) =>
  `<g fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="1.4"><path d="M30 8 L49 41 L11 41 Z"/><path d="M30 52 L11 19 L49 19 Z"/></g>`;
const star8 = (stroke: string, opacity: number) =>
  `<g fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="1.4"><rect x="15" y="15" width="30" height="30"/><rect x="15" y="15" width="30" height="30" transform="rotate(45 30 30)"/></g>`;

// ---- the library ------------------------------------------------------------

const deep: BackgroundPreset[] = [
  ["midnight", "Midnight navy", "linear-gradient(160deg, #0b1a33 0%, #12305c 100%)"],
  ["royal-blue", "Royal blue", "linear-gradient(160deg, #0d2a6b 0%, #1d4fa3 100%)"],
  ["sapphire", "Sapphire glow", "radial-gradient(circle at 30% 20%, #2a5db0 0%, #0a1a3a 70%)"],
  ["burgundy", "Burgundy velvet", "linear-gradient(160deg, #3a0a14 0%, #6b1a2a 100%)"],
  ["wine-gold", "Wine and gold", "radial-gradient(circle at 85% 10%, rgba(212, 175, 55, 0.28) 0%, transparent 45%), linear-gradient(160deg, #2b0a12 0%, #4a1320 100%)"],
  ["forest", "Forest", "linear-gradient(160deg, #0d2b1e 0%, #1f4d36 100%)"],
  ["emerald", "Emerald", "radial-gradient(circle at 50% 30%, #1d6b4f 0%, #0a2b20 75%)"],
  ["royal-purple", "Royal purple", "linear-gradient(160deg, #1f0d3a 0%, #3d1f66 100%)"],
  ["charcoal", "Charcoal", "linear-gradient(160deg, #16181c 0%, #2a2e35 100%)"],
  ["espresso", "Espresso", "linear-gradient(160deg, #1e1410 0%, #3b2a20 100%)"],
  ["deep-teal", "Deep teal", "linear-gradient(160deg, #062a2e 0%, #0f4c52 100%)"],
  ["slate-storm", "Slate", "linear-gradient(160deg, #1b2733 0%, #324354 100%)"],
  ["mesh-ocean", "Ocean mesh", "radial-gradient(circle at 15% 20%, #1d4fa3 0%, transparent 50%), radial-gradient(circle at 85% 80%, #0f6b6b 0%, transparent 55%), #0a1a33"],
  ["mesh-ember", "Ember mesh", "radial-gradient(circle at 20% 80%, #8a2a1a 0%, transparent 50%), radial-gradient(circle at 80% 20%, #6b3a0c 0%, transparent 55%), #1d0d08"],
].map(([id, name, css]) => ({ id, name, css, category: "Deep and rich", tone: "dark" as const }));

const light: BackgroundPreset[] = [
  ["ivory", "Ivory", "linear-gradient(170deg, #fbf8f1 0%, #f1eadb 100%)"],
  ["parchment", "Parchment", "radial-gradient(circle at 50% 40%, #fdf6e3 0%, #efe1c1 100%)"],
  ["soft-sky", "Soft sky", "linear-gradient(180deg, #eaf4fb 0%, #cfe3f3 100%)"],
  ["mint", "Mint", "linear-gradient(170deg, #eef8f3 0%, #d3ede0 100%)"],
  ["blush", "Blush", "linear-gradient(170deg, #fbf1f1 0%, #f1dada 100%)"],
  ["linen", "Linen", "linear-gradient(170deg, #f4f4f2 0%, #e2e2de 100%)"],
  ["sand", "Sand", "linear-gradient(170deg, #f7efe2 0%, #e9d8bd 100%)"],
  ["lavender", "Lavender mist", "linear-gradient(170deg, #f3f0fa 0%, #ddd4ee 100%)"],
  ["pearl", "Pearl", "radial-gradient(circle at 50% 35%, #ffffff 0%, #e8e8ee 100%)"],
  ["morning", "Morning", "linear-gradient(180deg, #fff7e8 0%, #ffe7c2 100%)"],
  ["mesh-dawn", "Dawn mesh", "radial-gradient(circle at 20% 20%, #ffe3c4 0%, transparent 55%), radial-gradient(circle at 80% 80%, #d8e8f6 0%, transparent 55%), #fbf7f0"],
].map(([id, name, css]) => ({ id, name, css, category: "Light and calm", tone: "light" as const }));

const warm: BackgroundPreset[] = [
  ["candlelight", "Candlelight", "radial-gradient(circle at 50% 65%, #ffb347 0%, #7a3a0c 45%, #1d0d05 100%)", "dark"],
  ["sunset", "Sunset", "linear-gradient(180deg, #2b1a4f 0%, #b3476b 60%, #f6a15a 100%)", "dark"],
  ["honey", "Amber honey", "linear-gradient(160deg, #6b3a05 0%, #d6922b 100%)", "dark"],
  ["golden-hour", "Golden hour", "linear-gradient(170deg, #f7d68a 0%, #e9a44c 100%)", "light"],
  ["copper", "Copper", "linear-gradient(160deg, #3a1a0d 0%, #8a4b2a 100%)", "dark"],
].map(([id, name, css, tone]) => ({ id, name, css, category: "Warm glow", tone: tone as BackgroundTone }));

const yomTov: BackgroundPreset[] = [
  ["shabbos", "Shabbos gold", "radial-gradient(ellipse at 50% 0%, rgba(212, 175, 55, 0.45) 0%, transparent 55%), linear-gradient(180deg, #0f1f3d 0%, #0a1428 100%)", "dark"],
  ["havdalah", "Havdalah twilight", "linear-gradient(180deg, #1a1440 0%, #4a2a6b 55%, #c2694a 100%)", "dark"],
  ["tishrei", "Tishrei honey", "linear-gradient(170deg, #fff4d6 0%, #f3c85e 100%)", "light"],
  ["yamim-noraim", "Yamim Noraim white", "radial-gradient(ellipse at 50% 0%, rgba(212, 175, 55, 0.22) 0%, transparent 50%), linear-gradient(180deg, #ffffff 0%, #f0efe9 100%)", "light"],
  ["sukkos", "Sukkos", "linear-gradient(160deg, #2f5d2a 0%, #7a8f3a 100%)", "dark"],
  ["simchas-torah", "Simchas Torah", "linear-gradient(135deg, #1d3c8f 0%, #6b2a8f 100%)", "dark"],
  ["chanukah", "Chanukah", "radial-gradient(circle at 20% 15%, rgba(220, 230, 255, 0.35) 0%, transparent 35%), radial-gradient(circle at 80% 85%, rgba(220, 230, 255, 0.25) 0%, transparent 40%), linear-gradient(160deg, #0d1f4d 0%, #2a4fa3 100%)", "dark"],
  ["tu-bshvat", "Tu B'Shvat", "linear-gradient(170deg, #e7f2df 0%, #b9d69c 100%)", "light"],
  ["purim", "Purim", "linear-gradient(135deg, #5a1a7a 0%, #c2366b 55%, #f2a33a 100%)", "dark"],
  ["pesach", "Pesach spring", "linear-gradient(170deg, #f4fbef 0%, #cfe8c4 100%)", "light"],
  ["shavuos", "Shavuos", "radial-gradient(circle at 15% 85%, rgba(242, 167, 190, 0.35) 0%, transparent 40%), radial-gradient(circle at 85% 15%, rgba(250, 214, 120, 0.35) 0%, transparent 40%), linear-gradient(170deg, #f5faf2 0%, #d9ecd0 100%)", "light"],
  ["three-weeks", "Three weeks", "linear-gradient(170deg, #2a2a30 0%, #4a4a52 100%)", "dark"],
].map(([id, name, css, tone]) => ({ id, name, css, category: "Shabbos and Yom Tov", tone: tone as BackgroundTone }));

const stone: BackgroundPreset[] = [
  ["jerusalem-stone", "Jerusalem stone", `${grain(0.35)} 0 0 / 22% auto repeat, linear-gradient(170deg, #ece0c8 0%, #d8c4a0 100%)`, "light"],
  ["golden-stone", "Golden stone", `${grain(0.35)} 0 0 / 22% auto repeat, linear-gradient(170deg, #e5cc9c 0%, #c9a86a 100%)`, "light"],
  ["kotel-evening", "Kotel at evening", `${grain(0.45)} 0 0 / 22% auto repeat, linear-gradient(170deg, #8a7658 0%, #4e4130 100%)`, "dark"],
  ["limestone", "Limestone", `${grain(0.3)} 0 0 / 22% auto repeat, linear-gradient(170deg, #e8e4dc 0%, #cfc9bd 100%)`, "light"],
  ["sandstone", "Rose sandstone", `${grain(0.35)} 0 0 / 22% auto repeat, linear-gradient(170deg, #ebcfb9 0%, #cfa488 100%)`, "light"],
].map(([id, name, css, tone]) => ({ id, name, css, category: "Jerusalem stone", tone: tone as BackgroundTone }));

const patterns: BackgroundPreset[] = [
  ["magen-david-navy", "Magen David on navy", pattern(star6("#d4af37", 0.32), 60, 60, 5, "linear-gradient(160deg, #0b1a33 0%, #12305c 100%)"), "dark"],
  ["magen-david-ivory", "Magen David on ivory", pattern(star6("#1d4fa3", 0.18), 60, 60, 5, "linear-gradient(170deg, #fbf8f1 0%, #f1eadb 100%)"), "light"],
  ["star-burgundy", "Eight-point star on burgundy", pattern(star8("#d4af37", 0.3), 60, 60, 5, "linear-gradient(160deg, #3a0a14 0%, #6b1a2a 100%)"), "dark"],
  ["star-sand", "Eight-point star on sand", pattern(star8("#8a6a3a", 0.22), 60, 60, 5, "linear-gradient(170deg, #f7efe2 0%, #e9d8bd 100%)"), "light"],
  ["hexagons", "Hexagons on slate", pattern(`<path d="M15 0 L45 0 L60 26 L45 52 L15 52 L0 26 Z" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1.4"/>`, 60, 52, 4.5, "linear-gradient(160deg, #1b2733 0%, #324354 100%)"), "dark"],
  ["lattice-gold", "Gold lattice", pattern(`<path d="M20 0 L40 20 L20 40 L0 20 Z" fill="none" stroke="#d4af37" stroke-opacity="0.28" stroke-width="1.2"/>`, 40, 40, 3.5, "linear-gradient(160deg, #111114 0%, #23232a 100%)"), "dark"],
  ["dots", "Quiet dots", pattern(`<circle cx="10" cy="10" r="1.6" fill="#ffffff" fill-opacity="0.12"/>`, 20, 20, 1.8, "linear-gradient(160deg, #16181c 0%, #2a2e35 100%)"), "dark"],
  ["dots-light", "Quiet dots, light", pattern(`<circle cx="10" cy="10" r="1.6" fill="#1b2a2e" fill-opacity="0.1"/>`, 20, 20, 1.8, "linear-gradient(170deg, #f4f4f2 0%, #e2e2de 100%)"), "light"],
  ["pinstripe", "Navy pinstripe", pattern(`<rect x="0" y="0" width="1.2" height="24" fill="#ffffff" fill-opacity="0.07"/>`, 24, 24, 1.6, "linear-gradient(160deg, #0b1a33 0%, #12305c 100%)"), "dark"],
  ["waves", "Teal waves", pattern(`<path d="M0 15 Q15 5 30 15 T60 15" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1.4"/>`, 60, 30, 4, "linear-gradient(160deg, #062a2e 0%, #0f4c52 100%)"), "dark"],
  ["arches", "Jerusalem arches", pattern(`<path d="M5 60 L5 28 A15 15 0 0 1 35 28 L35 60" fill="none" stroke="#8a6a3a" stroke-opacity="0.22" stroke-width="1.4"/>`, 40, 60, 3.5, "linear-gradient(170deg, #ece0c8 0%, #d8c4a0 100%)"), "light"],
  ["chevron", "Sage chevron", pattern(`<path d="M0 20 L20 5 L40 20" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1.6"/>`, 40, 24, 3, "linear-gradient(160deg, #3d5a45 0%, #587a60 100%)"), "dark"],
  ["scales", "Verdigris scales", pattern(`<path d="M0 20 A20 20 0 0 1 40 20 M-20 40 A20 20 0 0 1 20 40 M20 40 A20 20 0 0 1 60 40" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="1.3"/>`, 40, 40, 3.2, "linear-gradient(160deg, #0f3d38 0%, #1e6b63 100%)"), "dark"],
  ["crosshatch", "Linen weave", pattern(`<path d="M0 0 L12 12 M12 0 L0 12" stroke="#1b2a2e" stroke-opacity="0.06" stroke-width="1"/>`, 12, 12, 0.9, "linear-gradient(170deg, #f7f4ee 0%, #e9e4da 100%)"), "light"],
].map(([id, name, css, tone]) => ({ id, name, css, category: "Patterns", tone: tone as BackgroundTone }));

const sky: BackgroundPreset[] = [
  ["starry-night", "Starry night", `${stars(70, 7)} 0 0 / 30% auto repeat, linear-gradient(180deg, #050b1f 0%, #13244a 100%)`, "dark"],
  ["deep-space", "Deep space", `${stars(110, 11)} 0 0 / 25% auto repeat, radial-gradient(circle at 70% 30%, #1a1f3d 0%, #04050c 70%)`, "dark"],
  ["aurora", "Aurora", "radial-gradient(ellipse at 30% 30%, rgba(46, 204, 150, 0.35) 0%, transparent 50%), radial-gradient(ellipse at 70% 60%, rgba(64, 120, 220, 0.35) 0%, transparent 55%), linear-gradient(170deg, #061a2b 0%, #0b2a3a 100%)", "dark"],
  ["moonrise", "Moonrise", `radial-gradient(circle at 82% 18%, rgba(255, 250, 235, 0.9) 0%, rgba(255, 250, 235, 0.25) 5%, transparent 22%), ${stars(40, 23)} 0 0 / 30% auto repeat, linear-gradient(180deg, #0a1430 0%, #1d2d5a 100%)`, "dark"],
  ["twilight-stars", "Twilight stars", `${stars(45, 31)} 0 0 / 30% auto repeat, linear-gradient(180deg, #1a1440 0%, #3d2a66 60%, #7a4a7a 100%)`, "dark"],
].map(([id, name, css, tone]) => ({ id, name, css, category: "Night sky", tone: tone as BackgroundTone }));

export const BACKGROUND_PRESETS: BackgroundPreset[] = [...deep, ...light, ...warm, ...yomTov, ...stone, ...patterns, ...sky];

export const BACKGROUND_CATEGORIES: string[] = [...new Set(BACKGROUND_PRESETS.map((preset) => preset.category))];

const byId = new Map(BACKGROUND_PRESETS.map((preset) => [preset.id, preset]));

export function backgroundPreset(value: string): BackgroundPreset | null {
  return value.startsWith("preset:") ? (byId.get(value.slice(7)) ?? null) : null;
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

export type BackgroundKind = "none" | "color" | "gradient" | "preset";

export function backgroundKind(value: string): BackgroundKind {
  if (!value) return "none";
  if (value.startsWith("preset:")) return "preset";
  if (/^(linear|radial)-gradient\(/.test(value)) return "gradient";
  return "color";
}

/** The CSS `background` shorthand for a value, or undefined for none. */
export function backgroundCss(value: string): string | undefined {
  switch (backgroundKind(value)) {
    case "none":
      return undefined;
    case "preset":
      return backgroundPreset(value)?.css;
    default:
      return value;
  }
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
  if (kind === "preset") return backgroundPreset(value)?.tone ?? null;
  const colors = kind === "gradient" ? (parseGradient(value)?.stops.map((stop) => stop.color) ?? []) : [value];
  const lums = colors.map(luminance).filter((l): l is number => l !== null);
  if (lums.length === 0) return null;
  const average = lums.reduce((sum, l) => sum + l, 0) / lums.length;
  // 0.18 is roughly where white and near-black text have equal contrast.
  return average > 0.18 ? "light" : "dark";
}
