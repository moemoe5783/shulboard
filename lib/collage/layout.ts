import { createRng, randInt, shuffled, type Rng } from "./random.ts";

/*
 * The collage layout engine — a slicing tree (guillotine layout) sized exactly.
 *
 * THE PHOTOS DESIGN THE LAYOUT. The only inputs are the box, the gap, and each
 * photo's aspect ratio. Every photo is placed at exactly its own aspect, so it
 * is never cropped or distorted; whatever the arrangement cannot fill is left
 * as background, and the composition is centred in the box.
 *
 * THE TREE. A leaf is one photo. An H node lays its children side by side at a
 * shared height; a V node stacks them at a shared width. Binary nodes are
 * enough — H(H(a,b),c) sizes identically to an n-ary H(a,b,c).
 *
 * EXACT SIZING. Every subtree has an affine width/height relation w = A·h + B:
 *   leaf (aspect a):  A = a,                 B = 0
 *   H(a, b):          A = A₁ + A₂,           B = B₁ + B₂ + gap
 *   V(a, b):          A = 1 / (1/A₁ + 1/A₂), B = A·(B₁/A₁ + B₂/A₂ − gap)
 * so the root fits a W×H box in closed form and a top-down walk hands every
 * photo its exact rectangle, with every gap exactly `gap`.
 *
 * THE SEARCH is randomized but deterministic: a seeded PRNG, a FIXED amount of
 * work (never a time budget — a slower screen doing fewer iterations would pick
 * a different layout than the editor did), and scores quantized before they're
 * compared so float noise between browser engines can't flip a tie.
 *
 * Pure TypeScript, no React, no DOM: the editor preview, the display and the
 * tests all run this same module.
 */

export type CollagePhoto = { id: string; width: number; height: number };
export type CollageBox = { width: number; height: number };
/** One photo's rectangle, in box units (the same units as `CollageBox`). */
export type CollageCell = { photoId: string; x: number; y: number; w: number; h: number };

export type CollageLayout = {
  cells: CollageCell[];
  /** Fraction of the box covered by photos, 0..1. */
  coverage: number;
  score: number;
  /** The smallest photo's short side, in box units. */
  minShortSide: number;
  /** The composition's own rectangle, centred in the box. */
  bounds: { x: number; y: number; w: number; h: number };
};

/** Scoring weights — one object, so they can be tuned in one place. */
export type CollageWeights = {
  /** The fraction of the box filled. The primary factor. */
  coverage: number;
  /** Penalty for any photo whose short side is under the minimum. */
  minSize: number;
  /** Penalty for uneven photo areas (coefficient of variation). */
  balance: number;
  /** Penalty for a panorama squeezed narrow, or a tall photo squeezed short. */
  extreme: number;
};

export type LayoutOptions = {
  /** The space between photos, in box units. */
  gap: number;
  /** A photo's short side should be at least this fraction of the box's short side. */
  minShortFraction: number;
  weights: CollageWeights;
  /** Search effort multiplier. 1 is a full build; pagination probes with less. */
  effort: number;
};

export const DEFAULT_WEIGHTS: CollageWeights = { coverage: 1, minSize: 2, balance: 0.08, extreme: 0.4 };

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  gap: 8,
  minShortFraction: 0.12,
  weights: DEFAULT_WEIGHTS,
  effort: 1,
};

/** Aspect ratios past these count as extreme: panoramas and very tall photos. */
const PANORAMA = 2.5;
const TALL = 0.4;
/** How much of the box an extreme photo should span along its long axis. */
const EXTREME_SPAN = 0.6;

// ---- the tree ---------------------------------------------------------------

const LEAF = 0;
const H = 1;
const V = 2;
type Op = typeof LEAF | typeof H | typeof V;

type Node = {
  op: Op;
  /** Photo index (leaves only). */
  i: number;
  a: Node | null;
  b: Node | null;
  /** The affine relation w = A·h + B, filled by `computeAffine`. */
  A: number;
  B: number;
};

const leaf = (i: number): Node => ({ op: LEAF, i, a: null, b: null, A: 0, B: 0 });
const split = (op: Op, a: Node, b: Node): Node => ({ op, i: -1, a, b, A: 0, B: 0 });

function clone(node: Node): Node {
  return node.op === LEAF ? leaf(node.i) : split(node.op, clone(node.a!), clone(node.b!));
}

function computeAffine(node: Node, aspects: readonly number[], gap: number): void {
  if (node.op === LEAF) {
    node.A = aspects[node.i];
    node.B = 0;
    return;
  }
  const a = node.a!;
  const b = node.b!;
  computeAffine(a, aspects, gap);
  computeAffine(b, aspects, gap);
  if (node.op === H) {
    node.A = a.A + b.A;
    node.B = a.B + b.B + gap;
  } else {
    node.A = 1 / (1 / a.A + 1 / b.A);
    node.B = node.A * (a.B / a.A + b.B / b.A - gap);
  }
}

/** Assign every leaf its rectangle, into `out` at [i*4 .. i*4+3]. False if any
 *  rectangle comes out empty (too many gaps for the box). */
function place(node: Node, x: number, y: number, w: number, h: number, gap: number, out: Float64Array): boolean {
  if (!(w > 0) || !(h > 0)) return false;
  if (node.op === LEAF) {
    const at = node.i * 4;
    out[at] = x;
    out[at + 1] = y;
    out[at + 2] = w;
    out[at + 3] = h;
    return true;
  }
  const a = node.a!;
  const b = node.b!;
  if (node.op === H) {
    const w1 = a.A * h + a.B;
    return place(a, x, y, w1, h, gap, out) && place(b, x + w1 + gap, y, w - w1 - gap, h, gap, out);
  }
  const h1 = (w - a.B) / a.A;
  return place(a, x, y, w, h1, gap, out) && place(b, x, y + h1 + gap, w, h - h1 - gap, gap, out);
}

function collect(node: Node, leaves: Node[], splits: Node[]): void {
  if (node.op === LEAF) {
    leaves.push(node);
    return;
  }
  splits.push(node);
  collect(node.a!, leaves, splits);
  collect(node.b!, leaves, splits);
}

function leafIndices(node: Node, out: number[] = []): number[] {
  if (node.op === LEAF) out.push(node.i);
  else {
    leafIndices(node.a!, out);
    leafIndices(node.b!, out);
  }
  return out;
}

// ---- evaluation -------------------------------------------------------------

type Evaluation = {
  score: number;
  coverage: number;
  minShortSide: number;
  bounds: { x: number; y: number; w: number; h: number };
};

const INVALID: Evaluation = { score: -Infinity, coverage: 0, minShortSide: 0, bounds: { x: 0, y: 0, w: 0, h: 0 } };

/** Quantize so float noise between JS engines can't reorder two equal scores. */
const quantize = (value: number) => Math.round(value * 1e9) / 1e9;

class Evaluator {
  readonly rects: Float64Array;
  readonly aspects: readonly number[];
  readonly box: CollageBox;
  readonly options: LayoutOptions;

  constructor(aspects: readonly number[], box: CollageBox, options: LayoutOptions) {
    this.aspects = aspects;
    this.box = box;
    this.options = options;
    this.rects = new Float64Array(aspects.length * 4);
  }

  /** Size the tree into the box and score it. Leaves `rects` filled. */
  evaluate(root: Node): Evaluation {
    const { aspects, box, options, rects } = this;
    const { gap, weights } = options;
    computeAffine(root, aspects, gap);

    let h = (box.width - root.B) / root.A;
    let w = box.width;
    if (h > box.height) {
      h = box.height;
      w = root.A * box.height + root.B;
    }
    const x0 = (box.width - w) / 2;
    const y0 = (box.height - h) / 2;
    if (!place(root, x0, y0, w, h, gap, rects)) return INVALID;

    const n = aspects.length;
    const boxArea = box.width * box.height;
    const threshold = options.minShortFraction * Math.min(box.width, box.height);

    let covered = 0;
    let areaSq = 0;
    let minShort = Infinity;
    let minPenalty = 0;
    let extreme = 0;
    for (let i = 0; i < n; i += 1) {
      const cw = rects[i * 4 + 2];
      const ch = rects[i * 4 + 3];
      const area = cw * ch;
      covered += area;
      areaSq += area * area;
      const short = Math.min(cw, ch);
      if (short < minShort) minShort = short;
      if (short < threshold) minPenalty += (1 - short / threshold) ** 2;
      const aspect = aspects[i];
      if (aspect >= PANORAMA) extreme += Math.max(0, EXTREME_SPAN - cw / box.width) / EXTREME_SPAN;
      else if (aspect <= TALL) extreme += Math.max(0, EXTREME_SPAN - ch / box.height) / EXTREME_SPAN;
    }

    const coverage = covered / boxArea;
    const mean = covered / n;
    const variance = Math.max(0, areaSq / n - mean * mean);
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    const score =
      weights.coverage * coverage - weights.minSize * minPenalty - weights.balance * cv - weights.extreme * extreme;

    return { score: quantize(score), coverage, minShortSide: minShort, bounds: { x: x0, y: y0, w, h } };
  }
}

// ---- candidate generation ---------------------------------------------------

/** A group's "natural" aspect — between one row (Σa) and one column (1/Σ(1/a)). */
function natural(ids: readonly number[], aspects: readonly number[]): number {
  let row = 0;
  let inv = 0;
  for (const i of ids) {
    row += aspects[i];
    inv += 1 / aspects[i];
  }
  return Math.sqrt(row / inv);
}

/**
 * Grow a tree top-down toward a target aspect: split the photos (in the given
 * order) at a point biased toward the middle, then choose side-by-side or
 * stacked by whichever lands the two halves nearer the target — softly, so the
 * search still explores the other.
 */
function grow(ids: readonly number[], target: number, aspects: readonly number[], rng: Rng): Node {
  if (ids.length === 1) return leaf(ids[0]);
  const m = ids.length;
  const k = 1 + Math.floor(((rng() + rng()) / 2) * (m - 1));
  const left = ids.slice(0, k);
  const right = ids.slice(k);
  const n1 = natural(left, aspects);
  const n2 = natural(right, aspects);

  const dh = Math.abs(Math.log((n1 + n2) / target));
  const dv = Math.abs(Math.log(1 / (1 / n1 + 1 / n2) / target));
  const pH = 1 / (1 + Math.exp((dh - dv) * 4));

  if (rng() < pH) {
    const share = n1 / (n1 + n2);
    return split(H, grow(left, target * share, aspects, rng), grow(right, target * (1 - share), aspects, rng));
  }
  const share = 1 / n1 / (1 / n1 + 1 / n2);
  return split(V, grow(left, target / share, aspects, rng), grow(right, target / (1 - share), aspects, rng));
}

function chain(op: Op, nodes: Node[]): Node {
  return nodes.reduce((acc, node) => split(op, acc, node));
}

/** Justified rows (and their transpose, columns): the classic baselines, so the
 *  search never does worse than a plain rows layout. */
function structured(n: number, aspects: readonly number[]): Node[] {
  const orders = [
    Array.from({ length: n }, (_, i) => i),
    Array.from({ length: n }, (_, i) => i).sort((p, q) => aspects[q] - aspects[p] || p - q),
  ];
  const out: Node[] = [];
  for (const order of orders) {
    for (let lines = 1; lines <= Math.min(n, 5); lines += 1) {
      const groups: Node[][] = [];
      for (let line = 0; line < lines; line += 1) {
        const from = Math.round((line * n) / lines);
        const to = Math.round(((line + 1) * n) / lines);
        groups.push(order.slice(from, to).map(leaf));
      }
      out.push(chain(V, groups.map((row) => chain(H, row))));
      out.push(chain(H, groups.map((column) => chain(V, column.map((node) => leaf(node.i))))));
    }
  }
  return out;
}

/** Change one thing about a (cloned) tree: swap two photos, flip a node between
 *  side-by-side and stacked, or regrow a whole subtree. */
function mutate(root: Node, aspects: readonly number[], rng: Rng): void {
  const leaves: Node[] = [];
  const splits: Node[] = [];
  collect(root, leaves, splits);
  if (splits.length === 0) return;

  const roll = rng();
  if (roll < 0.35 && leaves.length > 1) {
    const p = leaves[randInt(rng, leaves.length)];
    const q = leaves[randInt(rng, leaves.length)];
    [p.i, q.i] = [q.i, p.i];
  } else if (roll < 0.6) {
    const node = splits[randInt(rng, splits.length)];
    node.op = node.op === H ? V : H;
  } else {
    const node = splits[randInt(rng, splits.length)];
    const target = node.A > 0 ? node.A : 1;
    const fresh = grow(shuffled(leafIndices(node), rng), target, aspects, rng);
    node.op = fresh.op;
    node.i = fresh.i;
    node.a = fresh.a;
    node.b = fresh.b;
  }
}

// ---- the public entry point -------------------------------------------------

function emptyLayout(): CollageLayout {
  return { cells: [], coverage: 0, score: -Infinity, minShortSide: 0, bounds: { x: 0, y: 0, w: 0, h: 0 } };
}

/** A photo's aspect ratio, guarded so a missing dimension can't poison the maths. */
export function aspectOf(photo: { width: number; height: number }): number {
  const a = photo.width / photo.height;
  return Number.isFinite(a) && a > 0 ? a : 1;
}

/**
 * The best layout the search finds for `photos` in `box`. Deterministic for a
 * given (photos, box, options, seed).
 */
export function buildLayout(
  photos: readonly CollagePhoto[],
  box: CollageBox,
  options: Partial<LayoutOptions> = {},
  seed = 0,
): CollageLayout {
  const opts: LayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const n = photos.length;
  if (n === 0 || !(box.width > 0) || !(box.height > 0)) return emptyLayout();

  const aspects = photos.map(aspectOf);
  const evaluator = new Evaluator(aspects, box, opts);
  const rng = createRng(seed);
  const target = box.width / box.height;

  type Scored = { tree: Node; evaluation: Evaluation };
  const pool: Scored[] = [];
  const consider = (tree: Node) => pool.push({ tree, evaluation: evaluator.evaluate(tree) });

  if (n === 1) {
    consider(leaf(0));
  } else {
    for (const tree of structured(n, aspects)) consider(tree);
    const ids = Array.from({ length: n }, (_, i) => i);
    const generated = Math.max(4, Math.round((40 + 10 * n) * opts.effort));
    for (let g = 0; g < generated; g += 1) consider(grow(shuffled(ids, rng), target, aspects, rng));

    // Hill-climb from the best few. Sort is stable, so equal scores keep their
    // generation order — part of what makes the result reproducible.
    pool.sort((p, q) => q.evaluation.score - p.evaluation.score);
    const climbers = pool.slice(0, 4);
    const steps = Math.max(2, Math.round((30 + 8 * n) * opts.effort));
    for (const climber of climbers) {
      for (let s = 0; s < steps; s += 1) {
        const candidate = clone(climber.tree);
        computeAffine(candidate, aspects, opts.gap);
        mutate(candidate, aspects, rng);
        const evaluation = evaluator.evaluate(candidate);
        if (evaluation.score > climber.evaluation.score) {
          climber.tree = candidate;
          climber.evaluation = evaluation;
        }
      }
    }
    pool.splice(0, pool.length, ...climbers);
  }

  let best = pool[0];
  for (const entry of pool) if (entry.evaluation.score > best.evaluation.score) best = entry;
  if (best.evaluation.score === -Infinity) return emptyLayout();

  // Re-evaluate the winner so `rects` holds its rectangles, then read them out.
  const evaluation = evaluator.evaluate(best.tree);
  const r = evaluator.rects;
  const cells: CollageCell[] = photos.map((photo, i) => ({
    photoId: photo.id,
    x: r[i * 4],
    y: r[i * 4 + 1],
    w: r[i * 4 + 2],
    h: r[i * 4 + 3],
  }));

  return {
    cells,
    coverage: evaluation.coverage,
    score: evaluation.score,
    minShortSide: evaluation.minShortSide,
    bounds: evaluation.bounds,
  };
}
