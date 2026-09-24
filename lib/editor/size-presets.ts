/*
 * Preset shapes for photos and flyers, and which one a box is.
 *
 * A board's photo or gallery box is often a placeholder for something printed
 * or designed elsewhere — a kiddush flyer made in Canva, a 4 × 6 print. What
 * that person needs to know is the SHAPE of the hole, so what they make fits it
 * without being cropped or letterboxed. So a preset here is an aspect ratio
 * with the names people use for it, and a box "is" a preset when its width and
 * height are in that ratio, either way up.
 *
 * Deliberately no state: whether a box is on a preset is read off its size
 * every time. Stretch it by an edge and the ratio changes, so it simply stops
 * matching — nothing to keep in sync, and nothing stored in the board.
 */

export type SizePresetGroup = "Photos" | "Flyers and posters" | "Screens";

export type SizePreset = {
  id: string;
  group: SizePresetGroup;
  /** What people call it, in sentence case. */
  label: string;
  /** The short side and the long side, in whatever unit the name uses. The
   *  ratio is all that matters; the numbers are kept so the label and the
   *  ratio can't disagree. */
  short: number;
  long: number;
};

export const SIZE_PRESETS: readonly SizePreset[] = [
  { id: "photo-4x6", group: "Photos", label: "4 × 6 in photo", short: 4, long: 6 },
  { id: "photo-5x7", group: "Photos", label: "5 × 7 in photo", short: 5, long: 7 },
  { id: "photo-8x10", group: "Photos", label: "8 × 10 in photo", short: 8, long: 10 },
  { id: "photo-11x14", group: "Photos", label: "11 × 14 in photo", short: 11, long: 14 },
  { id: "square", group: "Photos", label: "Square", short: 1, long: 1 },
  { id: "letter", group: "Flyers and posters", label: "Letter flyer, 8.5 × 11 in", short: 8.5, long: 11 },
  { id: "half-letter", group: "Flyers and posters", label: "Half-letter flyer, 5.5 × 8.5 in", short: 5.5, long: 8.5 },
  { id: "legal", group: "Flyers and posters", label: "Legal, 8.5 × 14 in", short: 8.5, long: 14 },
  { id: "tabloid", group: "Flyers and posters", label: "Tabloid, 11 × 17 in", short: 11, long: 17 },
  { id: "a-series", group: "Flyers and posters", label: "A4, A3 or A5", short: 1, long: Math.SQRT2 },
  { id: "poster-18x24", group: "Flyers and posters", label: "18 × 24 in poster", short: 18, long: 24 },
  { id: "poster-24x36", group: "Flyers and posters", label: "24 × 36 in poster", short: 24, long: 36 },
  { id: "screen-16x9", group: "Screens", label: "Widescreen, 16:9", short: 9, long: 16 },
  { id: "screen-4x3", group: "Screens", label: "Standard, 4:3", short: 3, long: 4 },
];

export type Orientation = "portrait" | "landscape";

/** How close two shapes have to be to count as the same: half a percent.
 *  Tighter than any two presets here are to each other (5 × 7 and the A sizes
 *  are the nearest pair, about 1% apart), and looser than the rounding a
 *  corner drag at any zoom leaves behind. */
export const RATIO_TOLERANCE = 0.005;

const ratioOf = (preset: SizePreset) => preset.long / preset.short;

/** Portrait when taller than wide. A square is neither, and reads as portrait. */
export function orientationOf(w: number, h: number): Orientation {
  return w > h ? "landscape" : "portrait";
}

/**
 * Every preset this box's shape matches, either way up. More than one when two
 * presets share a shape — a 4 × 6 photo and a 24 × 36 poster are both 2:3 —
 * which is the honest answer: a flyer made for either fits.
 */
export function matchPresets(w: number, h: number): SizePreset[] {
  if (!(w > 0) || !(h > 0)) return [];
  const ratio = Math.max(w, h) / Math.min(w, h);
  return SIZE_PRESETS.filter((preset) => Math.abs(ratio / ratioOf(preset) - 1) <= RATIO_TOLERANCE);
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * The box reshaped to a preset: the same area and the same centre, so choosing
 * a shape doesn't also make the box jump or balloon, then scaled down if it
 * would no longer fit the canvas, and nudged back inside it.
 */
export function fitToPreset(
  rect: Rect,
  preset: SizePreset,
  orientation: Orientation,
  canvas: { width: number; height: number },
): Rect {
  const ratio = orientation === "landscape" ? ratioOf(preset) : 1 / ratioOf(preset); // w / h
  const area = Math.max(1, rect.w * rect.h);
  let w = Math.sqrt(area * ratio);
  let h = w / ratio;
  const scale = Math.min(1, canvas.width / w, canvas.height / h);
  w *= scale;
  h *= scale;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const x = Math.min(Math.max(0, cx - w / 2), canvas.width - w);
  const y = Math.min(Math.max(0, cy - h / 2), canvas.height - h);
  return { x, y, w, h };
}

/** A shape as people read it: "2:3", "1.29:1" when it isn't a tidy one. */
export function describeRatio(w: number, h: number): string {
  if (!(w > 0) || !(h > 0)) return "";
  const a = Math.round(w);
  const b = Math.round(h);
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  const d = gcd(a, b);
  if (a / d <= 32 && b / d <= 32) return `${a / d}:${b / d}`;
  return w >= h ? `${(w / h).toFixed(2)}:1` : `1:${(h / w).toFixed(2)}`;
}
