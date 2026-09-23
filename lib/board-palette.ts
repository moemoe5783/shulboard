/*
 * The colour palette offered when a gabbai picks a colour for something ON A
 * BOARD — a widget's background, text, border. Board content, not chrome
 * (design.md §1b), which is why these are literal colours rather than tokens:
 * a shul's board may use any colour, and a palette of real choices is the
 * point.
 *
 * Families of shades rather than a random spread, so picking "a darker version
 * of that" is one row over. Generated from hue + saturation at fixed
 * lightness steps, so every family's shades line up in the grid, then written
 * out as hex — what the colour fields already store.
 */

export type PaletteFamily = { name: string; colors: string[] };

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** Lightness steps, light to dark — seven shades per family. */
const SHADES = [93, 82, 68, 54, 41, 29, 18];

const FAMILIES: [name: string, hue: number, saturation: number][] = [
  ["Gold", 45, 78],
  ["Amber", 33, 85],
  ["Orange", 20, 80],
  ["Red", 2, 68],
  ["Burgundy", 345, 55],
  ["Rose", 328, 48],
  ["Purple", 275, 38],
  ["Indigo", 238, 42],
  ["Navy", 220, 55],
  ["Blue", 208, 70],
  ["Teal", 185, 55],
  ["Verdigris", 170, 48],
  ["Green", 135, 38],
  ["Olive", 68, 35],
  ["Brown", 26, 38],
  ["Slate", 210, 16],
];

export const PALETTE: PaletteFamily[] = [
  {
    name: "Neutrals",
    colors: ["#ffffff", "#f5f3ee", "#e6e3dc", "#cfcac0", "#a8a39a", "#7c786f", "#56534d", "#393733", "#24231f", "#000000"],
  },
  ...FAMILIES.map(([name, hue, saturation]) => ({
    name,
    colors: SHADES.map((lightness) => hslToHex(hue, saturation, lightness)),
  })),
];

/** Every palette colour, flat — for tests and "is this a palette colour?". */
export const PALETTE_COLORS: string[] = PALETTE.flatMap((family) => family.colors);
