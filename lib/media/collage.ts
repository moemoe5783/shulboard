/*
 * Collage layout — plan.md §7's two layers, at a v1 scale.
 *
 * Layer 1, templates: each is a set of fractional frames {x,y,w,h} in 0..1
 * within the collage box. A small hand-picked library keyed by photo count,
 * mixed orientations, rather than the ~40 the plan eventually wants.
 *
 * Layer 2, matching: given the photos' aspect ratios and the box's own aspect,
 * score every candidate template by how well its frames' shapes fit the photos
 * (a portrait photo in a wide frame crops badly), pick the best, and assign
 * each photo to a frame. Greedy monotonic assignment — sort frames and photos
 * by aspect and pair them in order — which minimises total shape mismatch for a
 * one-to-one pairing without the Hungarian algorithm the plan mentions for
 * later.
 *
 * Pure: no DOM, so scripts/test-collage.ts drives it directly.
 */

export type Frame = { x: number; y: number; w: number; h: number };
export type Placement = { frame: Frame; photoIndex: number };

/** A uniform cols×rows grid of frames, row-major. */
function grid(cols: number, rows: number): Frame[] {
  const frames: Frame[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      frames.push({ x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows });
    }
  }
  return frames;
}

/** Candidate templates per photo count (1–6). More than one where a different
 *  mix of frame shapes suits a different mix of photo orientations. */
const TEMPLATES: Record<number, Frame[][]> = {
  1: [[{ x: 0, y: 0, w: 1, h: 1 }]],
  2: [
    [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
    [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  ],
  3: [
    grid(3, 1),
    grid(1, 3),
    [
      { x: 0, y: 0, w: 0.6, h: 1 },
      { x: 0.6, y: 0, w: 0.4, h: 0.5 },
      { x: 0.6, y: 0.5, w: 0.4, h: 0.5 },
    ],
  ],
  4: [
    grid(2, 2),
    [
      { x: 0, y: 0, w: 0.6, h: 1 },
      { x: 0.6, y: 0, w: 0.4, h: 1 / 3 },
      { x: 0.6, y: 1 / 3, w: 0.4, h: 1 / 3 },
      { x: 0.6, y: 2 / 3, w: 0.4, h: 1 / 3 },
    ],
  ],
  5: [
    [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.25, h: 0.5 },
      { x: 0.75, y: 0, w: 0.25, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.25, h: 0.5 },
      { x: 0.75, y: 0.5, w: 0.25, h: 0.5 },
    ],
    [
      { x: 0, y: 0, w: 1 / 3, h: 0.5 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  ],
  6: [grid(3, 2), grid(2, 3)],
};

const MAX_FRAMES = 6;

/** The most photos a collage will place — clamps the requested count to what the
 *  template library covers and to what the album actually has. */
export function collageCount(requested: number, available: number): number {
  return Math.max(1, Math.min(requested, available, MAX_FRAMES));
}

/** The aspect a frame renders at inside a box of `boxAspect` (width/height). */
function frameAspect(frame: Frame, boxAspect: number): number {
  const h = frame.h || 1e-6;
  return (frame.w / h) * boxAspect;
}

/** How badly a set of frames fits a set of photos, under the best monotonic
 *  pairing — lower is better. Both sorted by aspect and paired in order. */
function score(frames: Frame[], photoAspects: number[], boxAspect: number): { total: number; placements: Placement[] } {
  const frameOrder = frames.map((frame, i) => ({ i, a: frameAspect(frame, boxAspect) })).sort((x, y) => x.a - y.a);
  const photoOrder = photoAspects.map((a, i) => ({ i, a })).sort((x, y) => x.a - y.a);

  let total = 0;
  const placements: Placement[] = [];
  for (let k = 0; k < frameOrder.length; k += 1) {
    const frame = frames[frameOrder[k].i];
    const photoIndex = photoOrder[k].i;
    total += Math.abs(Math.log(frameOrder[k].a / (photoAspects[photoIndex] || 1)));
    placements.push({ frame, photoIndex });
  }
  return { total, placements };
}

/**
 * The best template for `count` photos of the given aspects in a box of
 * `boxAspect`, and the photo-to-frame assignment. `variant` steps through the
 * candidates in score order — a "shuffle layout" that stays on the same photos.
 */
export function layoutCollage(input: {
  count: number;
  photoAspects: number[];
  boxAspect: number;
  variant?: number;
}): Placement[] {
  const { count, photoAspects, boxAspect, variant = 0 } = input;
  const candidates = TEMPLATES[count] ?? [grid(Math.ceil(Math.sqrt(count)), Math.ceil(count / Math.ceil(Math.sqrt(count))))];

  const ranked = candidates
    .filter((frames) => frames.length === count)
    .map((frames) => score(frames, photoAspects, boxAspect))
    .sort((a, b) => a.total - b.total);

  if (ranked.length === 0) {
    // No template of exactly this count (only happens past the library) — fall
    // back to a square-ish grid, unranked.
    const cols = Math.ceil(Math.sqrt(count));
    return score(grid(cols, Math.ceil(count / cols)).slice(0, count), photoAspects, boxAspect).placements;
  }

  return ranked[variant % ranked.length].placements;
}
