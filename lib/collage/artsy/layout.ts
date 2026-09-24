import { aspectOf, buildLayout, type CollageBox, type CollageCell, type CollageLayout, type CollagePhoto } from "../layout.ts";
import type { LayoutEngine, PaginateOptions } from "../paginate.ts";
import { createRng, hashSeed, randInt, shuffled, type Rng } from "../random.ts";
import { frameSpec, MIXED_SET, outerInsets, type FrameSpec, type FrameStyle, type Insets, type ItemFrameStyle } from "./frames.ts";
import {
  aabbHalf,
  containsPoint,
  corners,
  cosSin,
  degToRad,
  inflate,
  overlapArea,
  prepare,
  satPush,
  satPushPrepared,
  type Obb,
  type Prepared,
} from "./geometry.ts";

/*
 * The Artsy collage layout — spec §5. Photos as physical prints: framed,
 * tilted, a little overlapped, on a backdrop, arranged loosely but balanced.
 *
 * THE PHOTO IMAGE IS SACRED. Nothing — no other photo, frame, tape, pin or
 * shadow margin — may cover any part of any image. That is enforced as a hard
 * constraint by SAT between every image and every OTHER item's outer rect
 * (inflated by a shadow margin), checked at the end, and backed by a fallback
 * that is valid by construction. A layout that fails the check is never
 * returned.
 *
 * THE PIPELINE, per restart:
 *  1. seed — the Clean engine (../layout.ts) laid out on the photos' OUTER
 *     aspects (image + frame) with a wider gap: a balanced start, every cell
 *     already the right shape;
 *  2. scale variety — a hero or two up, a couple down;
 *  3. rotate — per the tilt level and its rules (§4);
 *  4. jitter — centres nudged so edges stop lining up;
 *  5. relax — push apart images from frames (hard), frame overlap past the cap
 *     (soft, then checked as hard), back inside the box, and a gentle pull
 *     toward the seed so the page doesn't drift apart; shrink the worst item 3%
 *     and relax again if a hard constraint won't settle;
 *  6. z-order, 7. fasteners — on the frame band only.
 * Several restarts, the best score wins (§5.2).
 *
 * DETERMINISTIC like Clean: a seeded PRNG, a FIXED amount of work (never a
 * time budget — a slow TV doing less would pick a different layout than the
 * editor), trig that is bit-identical across engines (./geometry.ts, cosSin),
 * positions quantized, and scores quantized before they're compared.
 */

export type ArtsyTilt = "none" | "subtle" | "playful";
export type ArtsyOverlap = "none" | "slight";

/** The knobs the lab tunes (spec §10). One object, so they live in one place. */
export type ArtsyTuning = {
  /** The gap the Clean seed leaves between outer rects, × the box's short side.
   *  Restarts are fixed work, not the spec's time budget, for the determinism
   *  reason above — 4 fits comfortably inside it. */
  gapFraction: number;
  /** How much a hero grows, and how much a shrunk item shrinks. */
  heroScale: [number, number];
  shrinkScale: [number, number];
  /** Centre jitter, × the item's own outer size. */
  jitter: number;
  /** Frame-on-frame overlap allowed, × the smaller item's frame area. */
  overlapCap: number;
  /** How hard items are pulled back toward their seeded centres each step. */
  pull: number;
  /** How much each item grows back into the seed's gap after being sized to
   *  its cell — more with Slight overlap, which is what makes frames meet. */
  growNone: number;
  growSlight: number;
  /** Relaxation steps and restarts at effort 1. */
  iterations: number;
  restarts: number;
  /** Room kept between an image and anything else, × the box's short side —
   *  so a neighbour's shadow falls on its frame, not the photo. */
  shadowMargin: number;
  /** Tilt ranges in degrees, for the two tilted levels. */
  subtle: [number, number];
  playful: [number, number];
  /** A multiplier on both tilt ranges — the lab's tilt slider. */
  tiltScale: number;
};

export type ArtsyWeights = {
  coverage: number;
  minSize: number;
  balance: number;
  hole: number;
  overlap: number;
  sliver: number;
  angle: number;
};

export type ArtsyOptions = {
  frame: FrameStyle;
  tilt: ArtsyTilt;
  overlap: ArtsyOverlap;
  fasteners: boolean;
  /** An image's short side should be at least this × the box's short side. */
  minShortFraction: number;
  /** Search effort. 1 is a full build; pagination probes with less. */
  effort: number;
  tuning: ArtsyTuning;
  weights: ArtsyWeights;
};

export const DEFAULT_ARTSY_TUNING: ArtsyTuning = {
  gapFraction: 0.04,
  heroScale: [1.05, 1.15],
  shrinkScale: [0.9, 0.95],
  jitter: 0.06,
  overlapCap: 0.12,
  pull: 0.04,
  growNone: 0.02,
  growSlight: 0.05,
  iterations: 120,
  restarts: 4,
  shadowMargin: 0.008,
  subtle: [2, 5],
  playful: [3, 10],
  tiltScale: 1,
};

export const DEFAULT_ARTSY_WEIGHTS: ArtsyWeights = {
  coverage: 1,
  minSize: 2,
  balance: 0.6,
  hole: 0.5,
  overlap: 0.04,
  sliver: 0.05,
  angle: 0.03,
};

export const DEFAULT_ARTSY_OPTIONS: ArtsyOptions = {
  frame: "polaroid",
  tilt: "subtle",
  overlap: "slight",
  fasteners: true,
  minShortFraction: 0.16,
  effort: 1,
  tuning: DEFAULT_ARTSY_TUNING,
  weights: DEFAULT_ARTSY_WEIGHTS,
};

/** A tape strip or pin, in the item's own unrotated frame: box units from the
 *  outer rect's top-left corner. `angle` in degrees, about its own centre. */
export type Fastener = { kind: "tape" | "pin"; x: number; y: number; w: number; h: number; angle: number; variant: number };

export type ArtsyItem = {
  photoId: string;
  style: ItemFrameStyle;
  spec: FrameSpec;
  /** Centre of the outer rect, in box units, and its tilt in degrees. */
  cx: number;
  cy: number;
  rotation: number;
  zIndex: number;
  /** The outer rect's size (image + paper + reach), box units. */
  outer: { w: number; h: number };
  /** The image within the outer rect, from its top-left, unrotated. */
  image: { x: number; y: number; w: number; h: number };
  /** The paper within the outer rect (the outer rect less the reach). */
  paper: { x: number; y: number; w: number; h: number };
  fasteners: Fastener[];
  /** Small per-item cosmetic randomness: paper tint, frame tone, grain offset. */
  variation: { tint: number; tone: number; grain: number };
  hero: boolean;
};

export type ArtsyLayout = CollageLayout & {
  items: ArtsyItem[];
  /** True when every hard rule holds. Always true for a returned layout with
   *  items — the flag is there for the lab and the tests to assert. */
  valid: boolean;
  /** Pairs of frames that overlap, and the largest overlap as a share of the
   *  cap (≤ 1 always). */
  overlapPairs: number;
  maxOverlapOfCap: number;
  /** The largest empty square, as a share of the box. */
  hole: number;
  /** Whether the fallback arrangement (each item in its own seed cell) won. */
  fallback: boolean;
};

// ---- item state ----------------------------------------------------------------

type State = {
  id: string;
  spec: FrameSpec;
  ins: Insets;
  /** Image size for a short side of 1. */
  uw: number;
  uh: number;
  /** Image short side, box units — the item's scale. */
  k: number;
  cx: number;
  cy: number;
  /** Seeded centre, which relaxation pulls back toward. */
  sx: number;
  sy: number;
  deg: number;
  hero: boolean;
};

const outerW = (s: State) => (s.uw + s.ins.l + s.ins.r) * s.k;
const outerH = (s: State) => (s.uh + s.ins.t + s.ins.b) * s.k;

function outerObb(s: State): Obb {
  return { cx: s.cx, cy: s.cy, hw: outerW(s) / 2, hh: outerH(s) / 2, angle: degToRad(s.deg) };
}

function imageObb(s: State): Obb {
  const angle = degToRad(s.deg);
  const { c, s: sn } = cosSin(angle);
  // The image's centre, offset from the outer centre by the uneven margins
  // (a Polaroid's deep bottom strip), turned with the item.
  const ox = ((s.ins.l - s.ins.r) / 2) * s.k;
  const oy = ((s.ins.t - s.ins.b) / 2) * s.k;
  return { cx: s.cx + ox * c - oy * sn, cy: s.cy + ox * sn + oy * c, hw: (s.uw * s.k) / 2, hh: (s.uh * s.k) / 2, angle };
}

const frameArea = (s: State) => outerW(s) * outerH(s) - s.uw * s.uh * s.k * s.k;
const radius = (s: State) => Math.sqrt(outerW(s) ** 2 + outerH(s) ** 2) / 2;

const q6 = (v: number) => Math.round(v * 1e6) / 1e6;
const quantize = (v: number) => Math.round(v * 1e9) / 1e9;

// ---- constraints ---------------------------------------------------------------

type Ctx = {
  box: CollageBox;
  margin: number;
  eps: number;
  overlap: ArtsyOverlap;
  cap: number;
};

/** An item's three shapes, prepared once per move: its image, its outer rect,
 *  and its outer rect grown by the shadow margin. */
type Shapes = { image: Prepared; outer: Prepared; halo: Prepared; frameArea: number; radius: number };

function shapesOf(s: State, ctx: Ctx): Shapes {
  const outer = outerObb(s);
  return {
    image: prepare(imageObb(s)),
    outer: prepare(outer),
    halo: prepare(inflate(outer, ctx.margin)),
    frameArea: frameArea(s),
    radius: radius(s),
  };
}

const lengthSq = (v: { x: number; y: number }) => v.x * v.x + v.y * v.y;

/** The push (for item a; b gets the opposite) that clears the hard rule
 *  between them — no image under another item's outer rect or its shadow
 *  margin — or null if it already holds. */
function hardPush(a: Shapes, b: Shapes, ctx: Ctx): { x: number; y: number } | null {
  const pa = satPushPrepared(a.image, b.halo, ctx.eps);
  const pbRaw = satPushPrepared(b.image, a.halo, ctx.eps);
  const pb = pbRaw ? { x: -pbRaw.x, y: -pbRaw.y } : null;
  if (!pa) return pb;
  if (!pb) return pa;
  return lengthSq(pa) >= lengthSq(pb) ? pa : pb;
}

/** Frame-on-frame: none allowed with Overlap: none; past the cap with Slight. */
function framePush(a: Shapes, b: Shapes, ctx: Ctx, soft: number): { x: number; y: number } | null {
  const push = satPushPrepared(a.outer, b.outer, ctx.eps);
  if (!push || ctx.overlap === "none") return push;
  const area = overlapArea(a.outer.box, b.outer.box);
  if (area <= ctx.cap * Math.min(a.frameArea, b.frameArea)) return null;
  return { x: push.x * soft, y: push.y * soft };
}

/** Keep the whole rotated outline inside the box — shrinking the item if its
 *  rotated bounding box can't fit at all. */
function fitBox(s: State, box: CollageBox): void {
  let { hx, hy } = aabbHalf(outerObb(s));
  if (2 * hx > box.width || 2 * hy > box.height) {
    s.k *= Math.min(box.width / (2 * hx), box.height / (2 * hy)) * 0.995;
    ({ hx, hy } = aabbHalf(outerObb(s)));
  }
  s.cx = Math.min(Math.max(s.cx, hx), box.width - hx);
  s.cy = Math.min(Math.max(s.cy, hy), box.height - hy);
}

function relax(states: State[], ctx: Ctx, steps: number, pull: number): void {
  const n = states.length;
  const extra = ctx.eps * 50;
  let quiet = 0;
  for (let step = 0; step < steps; step += 1) {
    // The pull toward the seed fades out over the first half: it shapes the
    // composition early, then stops fighting the pushes so the page settles.
    const k = Math.max(0, 1 - step / (steps / 2));
    for (const s of states) {
      s.cx += (s.sx - s.cx) * pull * k;
      s.cy += (s.sy - s.cy) * pull * k;
    }
    const shapes = states.map((s) => shapesOf(s, ctx));
    let pushed = false;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = states[i];
        const b = states[j];
        const dx = a.cx - b.cx;
        const dy = a.cy - b.cy;
        const reach = shapes[i].radius + shapes[j].radius + ctx.margin * 2;
        if (dx * dx + dy * dy > reach * reach) continue;
        const hard = hardPush(shapes[i], shapes[j], ctx);
        const soft = framePush(shapes[i], shapes[j], ctx, 0.3);
        let push = hard;
        if (soft && (!push || lengthSq(soft) > lengthSq(push))) push = soft;
        if (!push) continue;
        pushed = true;
        const len = Math.sqrt(lengthSq(push)) || 1;
        const px = (push.x / 2) * 1.02 + (push.x / len) * extra;
        const py = (push.y / 2) * 1.02 + (push.y / len) * extra;
        a.cx += px;
        a.cy += py;
        b.cx -= px;
        b.cy -= py;
        shapes[i] = shapesOf(a, ctx);
        shapes[j] = shapesOf(b, ctx);
      }
    }
    for (const s of states) fitBox(s, ctx.box);
    // Settled: nothing needed pushing for a few steps running. The pull alone
    // only ever eases items toward where they were seeded, which relaxing
    // longer would just undo again.
    quiet = pushed || k > 0 ? 0 : quiet + 1;
    if (quiet >= 2) break;
  }
}

/** Every broken rule, counted per item so the worst offender can be shrunk. */
function audit(states: State[], ctx: Ctx): { total: number; perItem: number[] } {
  const n = states.length;
  const perItem = new Array<number>(n).fill(0);
  let total = 0;
  const shapes = states.map((s) => shapesOf(s, ctx));
  for (let i = 0; i < n; i += 1) {
    const { hx, hy } = aabbHalf(shapes[i].outer.box);
    const s = states[i];
    const tol = 1e-7;
    if (s.cx - hx < -tol || s.cy - hy < -tol || s.cx + hx > ctx.box.width + tol || s.cy + hy > ctx.box.height + tol) {
      perItem[i] += 1;
      total += 1;
    }
    for (let j = i + 1; j < n; j += 1) {
      const a = shapes[i];
      const b = shapes[j];
      let broken = satPushPrepared(a.image, b.halo, 0) !== null || satPushPrepared(b.image, a.halo, 0) !== null;
      if (!broken && satPushPrepared(a.outer, b.outer, 0) !== null) {
        broken =
          ctx.overlap === "none" ||
          overlapArea(a.outer.box, b.outer.box) > ctx.cap * Math.min(a.frameArea, b.frameArea) * (1 + 1e-6);
      }
      if (broken) {
        perItem[i] += 1;
        perItem[j] += 1;
        total += 1;
      }
    }
  }
  return { total, perItem };
}

// ---- tilt ----------------------------------------------------------------------

/**
 * Tilts per the spec's rules (§4): about a fifth nearly straight (under 1.5°),
 * neighbours never within a degree of each other, and the direction flipping
 * often enough that the page doesn't lean.
 */
function assignTilts(states: State[], tilt: ArtsyTilt, tuning: ArtsyTuning, rng: Rng): void {
  if (tilt === "none") {
    for (const s of states) s.deg = 0;
    return;
  }
  const [lo0, hi0] = tilt === "subtle" ? tuning.subtle : tuning.playful;
  const lo = lo0 * tuning.tiltScale;
  const hi = Math.max(lo, hi0 * tuning.tiltScale);
  const n = states.length;
  const order = states
    .map((s, i) => ({ i, s }))
    .sort((p, q) => p.s.sy - q.s.sy || p.s.sx - q.s.sx || p.i - q.i)
    .map((entry) => entry.i);
  const straightCount = n >= 3 ? Math.max(1, Math.round(n * 0.2)) : 0;
  const straight = new Set(shuffled(order, rng).slice(0, straightCount));
  const done: number[] = [];
  let sign = rng() < 0.5 ? -1 : 1;

  for (const i of order) {
    const s = states[i];
    // Flip direction most of the time; a run of two the same way is fine.
    if (rng() < 0.75) sign = -sign;
    let deg = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const magnitude = straight.has(i) ? 0.2 + rng() * 1.2 : lo + rng() * (hi - lo);
      deg = sign * magnitude;
      const clash = done.some((j) => {
        const o = states[j];
        const reach = (radius(s) + radius(o)) * 1.15;
        const dx = s.sx - o.sx;
        const dy = s.sy - o.sy;
        return dx * dx + dy * dy < reach * reach && Math.abs(o.deg - deg) < 1.2;
      });
      if (!clash) break;
      if (attempt % 2 === 1) sign = -sign;
    }
    s.deg = q6(deg);
    done.push(i);
  }
}

// ---- scoring -------------------------------------------------------------------

const GRID = 40;

type Metrics = {
  coverage: number;
  hole: number;
  centreOff: number;
  minShort: number;
  minPenalty: number;
  overlapPairs: number;
  slivers: number;
  maxOverlapOfCap: number;
  similarAngles: number;
};

function measure(states: State[], ctx: Ctx, minShortFraction: number): Metrics {
  const { box } = ctx;
  const outers = states.map(outerObb);
  const halves = outers.map(aabbHalf);
  const cw = box.width / GRID;
  const ch = box.height / GRID;
  const empty = new Uint8Array(GRID * GRID);
  let covered = 0;
  let mx = 0;
  let my = 0;
  for (let gy = 0; gy < GRID; gy += 1) {
    const y = (gy + 0.5) * ch;
    for (let gx = 0; gx < GRID; gx += 1) {
      const x = (gx + 0.5) * cw;
      let hit = false;
      for (let i = 0; i < outers.length && !hit; i += 1) {
        const o = outers[i];
        if (Math.abs(x - o.cx) > halves[i].hx || Math.abs(y - o.cy) > halves[i].hy) continue;
        hit = containsPoint(o, x, y);
      }
      if (hit) {
        covered += 1;
        mx += x;
        my += y;
      } else empty[gy * GRID + gx] = 1;
    }
  }
  // The largest empty square of grid cells (the classic DP).
  const dp = new Uint16Array(GRID * GRID);
  let side = 0;
  for (let gy = 0; gy < GRID; gy += 1) {
    for (let gx = 0; gx < GRID; gx += 1) {
      const at = gy * GRID + gx;
      if (!empty[at]) continue;
      const up = gy > 0 ? dp[at - GRID] : 0;
      const left = gx > 0 ? dp[at - 1] : 0;
      const diag = gy > 0 && gx > 0 ? dp[at - GRID - 1] : 0;
      dp[at] = 1 + Math.min(up, left, diag);
      if (dp[at] > side) side = dp[at];
    }
  }
  const coverage = covered / (GRID * GRID);
  const centreOff = covered
    ? Math.sqrt(((mx / covered - box.width / 2) / box.width) ** 2 + ((my / covered - box.height / 2) / box.height) ** 2)
    : 1;

  const threshold = minShortFraction * Math.min(box.width, box.height);
  let minShort = Infinity;
  let minPenalty = 0;
  for (const s of states) {
    if (s.k < minShort) minShort = s.k;
    if (s.k < threshold) minPenalty += (1 - s.k / threshold) ** 2;
  }

  let overlapPairs = 0;
  let slivers = 0;
  let maxOverlapOfCap = 0;
  let similarAngles = 0;
  for (let i = 0; i < states.length; i += 1) {
    for (let j = i + 1; j < states.length; j += 1) {
      const area = overlapArea(outers[i], outers[j]);
      const frame = Math.min(frameArea(states[i]), frameArea(states[j]));
      if (area > 0 && frame > 0) {
        const share = area / frame;
        if (share < 0.01) slivers += 1;
        else overlapPairs += 1;
        if (ctx.cap > 0) maxOverlapOfCap = Math.max(maxOverlapOfCap, share / ctx.cap);
      }
      const a = states[i];
      const b = states[j];
      const reach = (radius(a) + radius(b)) * 1.15;
      const dx = a.cx - b.cx;
      const dy = a.cy - b.cy;
      if (dx * dx + dy * dy < reach * reach && Math.abs(a.deg - b.deg) < 1.2 && (a.deg !== 0 || b.deg !== 0)) similarAngles += 1;
    }
  }

  return {
    coverage,
    hole: (side * side) / (GRID * GRID),
    centreOff,
    minShort: Number.isFinite(minShort) ? minShort : 0,
    minPenalty,
    overlapPairs,
    slivers,
    maxOverlapOfCap,
    similarAngles,
  };
}

function scoreOf(m: Metrics, options: ArtsyOptions): number {
  const w = options.weights;
  const overlapReward = options.overlap === "slight" ? Math.min(m.overlapPairs, 3) / 3 : 0;
  return quantize(
    w.coverage * Math.min(m.coverage, 0.95) -
      w.minSize * m.minPenalty -
      w.balance * m.centreOff -
      w.hole * m.hole +
      w.overlap * overlapReward -
      w.sliver * m.slivers -
      w.angle * m.similarAngles,
  );
}

// ---- building ------------------------------------------------------------------

/** The per-item frame: fixed per photo within a page (so every restart agrees). */
function styleFor(photo: CollagePhoto, options: ArtsyOptions, seed: number): FrameSpec {
  const style: ItemFrameStyle =
    options.frame === "mixed" ? MIXED_SET[hashSeed(seed, "style", photo.id) % MIXED_SET.length] : options.frame;
  return frameSpec(style, options.fasteners);
}

function initialStates(photos: readonly CollagePhoto[], specs: readonly FrameSpec[]): State[] {
  return photos.map((photo, i) => {
    const aspect = aspectOf(photo);
    const uw = aspect >= 1 ? aspect : 1;
    const uh = aspect >= 1 ? 1 : 1 / aspect;
    return {
      id: photo.id,
      spec: specs[i],
      ins: outerInsets(specs[i]),
      uw,
      uh,
      k: 0,
      cx: 0,
      cy: 0,
      sx: 0,
      sy: 0,
      deg: 0,
      hero: false,
    };
  });
}

/** Lay the Clean engine out on the outer shapes and read each item's scale and
 *  centre off its cell. */
function seedFromCells(states: State[], cells: readonly CollageCell[]): void {
  states.forEach((s, i) => {
    const cell = cells[i];
    s.k = cell.w / (s.uw + s.ins.l + s.ins.r);
    s.cx = s.sx = cell.x + cell.w / 2;
    s.cy = s.sy = cell.y + cell.h / 2;
  });
}

/** Each item tilted and scaled to fit inside its own seed cell, less the
 *  margin — no two can touch, so it satisfies every hard rule by construction.
 *  The layout that is always available. */
function fitInCells(states: State[], cells: readonly CollageCell[], margin: number): void {
  states.forEach((s, i) => {
    const cell = cells[i];
    const { c, s: sn } = cosSin(degToRad(s.deg));
    const ow = s.uw + s.ins.l + s.ins.r;
    const oh = s.uh + s.ins.t + s.ins.b;
    const ax = ow * Math.abs(c) + oh * Math.abs(sn);
    const ay = ow * Math.abs(sn) + oh * Math.abs(c);
    const room = margin * 1.6;
    s.k = Math.max(1e-6, Math.min((cell.w - 2 * room) / ax, (cell.h - 2 * room) / ay));
    s.cx = cell.x + cell.w / 2;
    s.cy = cell.y + cell.h / 2;
  });
}

function lerp(rng: Rng, [lo, hi]: [number, number]): number {
  return lo + rng() * (hi - lo);
}

function scaleVariety(states: State[], tuning: ArtsyTuning, rng: Rng): void {
  const n = states.length;
  if (n < 2) return;
  const bySize = states
    .map((s, i) => ({ i, area: outerW(s) * outerH(s) }))
    .sort((p, q) => q.area - p.area || p.i - q.i)
    .map((entry) => entry.i);
  const heroes = n >= 6 && rng() < 0.6 ? 2 : 1;
  for (const i of bySize.slice(0, heroes)) {
    states[i].k *= lerp(rng, tuning.heroScale);
    states[i].hero = true;
  }
  const shrink = n >= 4 ? Math.min(2, n - heroes) : 0;
  for (const i of bySize.slice(n - shrink)) states[i].k *= lerp(rng, tuning.shrinkScale);
}

function jitter(states: State[], tuning: ArtsyTuning, rng: Rng): void {
  for (const s of states) {
    s.cx += (rng() * 2 - 1) * tuning.jitter * outerW(s);
    s.cy += (rng() * 2 - 1) * tuning.jitter * outerH(s);
  }
}

function quantizeStates(states: State[]): void {
  for (const s of states) {
    s.cx = q6(s.cx);
    s.cy = q6(s.cy);
    s.k = q6(s.k);
  }
}

/** Tape and pins on the frame band above the image — never over it. */
function fastenersFor(s: State, rng: Rng): Fastener[] {
  const spec = s.spec;
  if (spec.fastener === "none") return [];
  const ow = outerW(s);
  // The band between the outer top and the image top: reach + paper.
  const band = (spec.reach.t + spec.paper.t) * s.k;
  const variant = randInt(rng, 3);
  if (spec.fastener === "pin") {
    const r = Math.min(band * 0.38, ow * 0.05);
    const x = ow / 2 + (rng() - 0.5) * ow * 0.1;
    return [{ kind: "pin", x: x - r, y: band / 2 - r, w: 2 * r, h: 2 * r, angle: 0, variant }];
  }
  const out: Fastener[] = [];
  const h = band * 0.55;
  const strips = ow > band * 12 && rng() < 0.55 ? 2 : 1;
  for (let t = 0; t < strips; t += 1) {
    let deg = (3 + rng() * 7) * (rng() < 0.5 ? -1 : 1);
    let len = Math.min(ow * 0.3, band * 5);
    // Shorten or straighten until the turned strip fits the band's height.
    for (let tries = 0; tries < 12; tries += 1) {
      const { c, s: sn } = cosSin(degToRad(deg));
      const vertical = len * Math.abs(sn) + h * Math.abs(c);
      if (vertical <= band * 0.96) break;
      if (len > h * 2.5) len *= 0.85;
      else deg *= 0.7;
    }
    const { c, s: sn } = cosSin(degToRad(deg));
    const horizontal = len * Math.abs(c) + h * Math.abs(sn);
    const x =
      strips === 1
        ? ow / 2 + (rng() - 0.5) * ow * 0.15
        : t === 0
          ? horizontal / 2 + ow * 0.06
          : ow - horizontal / 2 - ow * 0.06;
    const tape: Fastener = { kind: "tape", x: x - len / 2, y: band / 2 - h / 2, w: len, h, angle: q6(deg), variant };
    // Confirm the turned strip sits wholly in the band and within the width;
    // drop it if not (spec §5.1.7: move it or drop it).
    const pts = corners({ cx: x, cy: band / 2, hw: len / 2, hh: h / 2, angle: degToRad(deg) });
    if (pts.every((p) => p.y >= -1e-9 && p.y <= band + 1e-9 && p.x >= -1e-9 && p.x <= ow + 1e-9)) out.push(tape);
  }
  return out;
}

function toItems(states: State[], box: CollageBox, seed: number): ArtsyItem[] {
  const rng = createRng(hashSeed(seed, "dress"));
  const n = states.length;
  // 6. Z-order: heroes, and items nearer the centre, a little likelier on top.
  // Images are protected, so this only decides which frame sits over which.
  const zRank = states
    .map((s, i) => {
      const off = Math.sqrt(((s.cx - box.width / 2) / box.width) ** 2 + ((s.cy - box.height / 2) / box.height) ** 2);
      return { i, p: (s.hero ? 0.5 : 0) + rng() * 0.4 - off };
    })
    .sort((p, q) => p.p - q.p || p.i - q.i);
  const z = new Array<number>(n);
  zRank.forEach((entry, rank) => {
    z[entry.i] = rank + 1;
  });
  return states.map((s, i) => {
    const ow = outerW(s);
    const oh = outerH(s);
    const { paper, reach } = s.spec;
    return {
      photoId: s.id,
      style: s.spec.style,
      spec: s.spec,
      cx: s.cx,
      cy: s.cy,
      rotation: s.deg,
      zIndex: z[i],
      outer: { w: q6(ow), h: q6(oh) },
      image: {
        x: q6((paper.l + reach.l) * s.k),
        y: q6((paper.t + reach.t) * s.k),
        w: q6(s.uw * s.k),
        h: q6(s.uh * s.k),
      },
      paper: { x: q6(reach.l * s.k), y: q6(reach.t * s.k), w: q6(ow - (reach.l + reach.r) * s.k), h: q6(oh - (reach.t + reach.b) * s.k) },
      fasteners: fastenersFor(s, rng),
      variation: { tint: randInt(rng, 4), tone: randInt(rng, 3), grain: q6(rng()) },
      hero: s.hero,
    };
  });
}

function emptyArtsy(): ArtsyLayout {
  return {
    cells: [],
    items: [],
    coverage: 0,
    score: -Infinity,
    minShortSide: 0,
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    valid: true,
    overlapPairs: 0,
    maxOverlapOfCap: 0,
    hole: 0,
    fallback: false,
  };
}

/**
 * The best Artsy layout for `photos` in `box`. Deterministic for a given
 * (photos, box, options, seed). Every returned item satisfies the hard rules.
 */
export function buildArtsyLayout(
  photos: readonly CollagePhoto[],
  box: CollageBox,
  options: Partial<ArtsyOptions> = {},
  seed = 0,
): ArtsyLayout {
  const opts: ArtsyOptions = {
    ...DEFAULT_ARTSY_OPTIONS,
    ...options,
    tuning: { ...DEFAULT_ARTSY_TUNING, ...options.tuning },
    weights: { ...DEFAULT_ARTSY_WEIGHTS, ...options.weights },
  };
  const n = photos.length;
  if (n === 0 || !(box.width > 0) || !(box.height > 0)) return emptyArtsy();

  const short = Math.min(box.width, box.height);
  const { tuning } = opts;
  const ctx: Ctx = {
    box,
    margin: tuning.shadowMargin * short,
    eps: short * 1e-7,
    overlap: opts.overlap,
    cap: opts.overlap === "none" ? 0 : tuning.overlapCap,
  };
  const specs = photos.map((photo) => styleFor(photo, opts, seed));
  const effort = Math.max(0.05, opts.effort);
  const restarts = Math.max(1, Math.round(tuning.restarts * Math.min(1, effort)));
  const steps = Math.max(30, Math.round(tuning.iterations * Math.min(1, effort)));

  type Candidate = { states: State[]; score: number; metrics: Metrics; fallback: boolean };
  let best: Candidate | null = null;
  const offer = (states: State[], fallback: boolean) => {
    quantizeStates(states);
    if (audit(states, ctx).total > 0) return;
    const metrics = measure(states, ctx, opts.minShortFraction);
    const score = scoreOf(metrics, opts);
    if (!best || score > best.score) best = { states, score, metrics, fallback };
  };

  for (let r = 0; r < restarts; r += 1) {
    const rng = createRng(hashSeed(seed, "artsy", r));
    const states = initialStates(photos, specs);
    // 1. Seed: Clean on the outer shapes, with a wider gap.
    const outerPhotos = states.map((s, i) => ({
      id: photos[i].id,
      width: (s.uw + s.ins.l + s.ins.r) * 1000,
      height: (s.uh + s.ins.t + s.ins.b) * 1000,
    }));
    const seedLayout = buildLayout(outerPhotos, box, { gap: tuning.gapFraction * short, effort: 0.35 * Math.min(1, effort) }, hashSeed(seed, "seed", r));
    if (seedLayout.cells.length !== n) continue;
    seedFromCells(states, seedLayout.cells);

    // The always-valid arrangement, tilted like the real attempt will be.
    const fallback = initialStates(photos, specs);
    seedFromCells(fallback, seedLayout.cells);

    // 2–4. Tilt, then size each tilted item to its seed cell (a turned print's
    // bounding box is bigger than its cell, and starting there is what keeps
    // the relaxation from spending its time shrinking), then scale variety
    // and jitter.
    assignTilts(states, opts.tilt, tuning, rng);
    fallback.forEach((f, i) => {
      f.deg = states[i].deg;
    });
    fitInCells(fallback, seedLayout.cells, ctx.margin);
    fitInCells(states, seedLayout.cells, 0);
    // The gap the seed left is room to grow back into, a little.
    // With Slight overlap, growing a little more is what lets neighbouring
    // frames tuck over each other once relaxed.
    const grow = opts.overlap === "slight" ? tuning.growSlight : tuning.growNone;
    for (const s of states) s.k *= 1 + grow;
    scaleVariety(states, tuning, rng);
    jitter(states, tuning, rng);
    for (const s of states) fitBox(s, box);

    // 5. Relax, shrinking the worst offender while a hard rule won't settle.
    relax(states, ctx, steps, tuning.pull);
    for (let round = 0; round < 30; round += 1) {
      quantizeStates(states);
      const { total, perItem } = audit(states, ctx);
      if (total === 0) break;
      let worst = 0;
      for (let i = 1; i < n; i += 1) {
        if (perItem[i] > perItem[worst] || (perItem[i] === perItem[worst] && states[i].k > states[worst].k)) worst = i;
      }
      states[worst].k *= 0.97;
      // Relaxing without the pull back to the seed, which is what usually
      // holds a crowded pair together.
      relax(states, ctx, Math.max(10, Math.round(steps / 4)), 0);
    }
    offer(states, false);
    offer(fallback, true);
  }

  const winner = best as Candidate | null;
  if (!winner) return emptyArtsy();
  const items = toItems(winner.states, box, seed);
  const cells: CollageCell[] = items.map((item) => ({
    photoId: item.photoId,
    x: item.cx - item.outer.w / 2,
    y: item.cy - item.outer.h / 2,
    w: item.outer.w,
    h: item.outer.h,
  }));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const item of items) {
    const { hx, hy } = aabbHalf({ cx: item.cx, cy: item.cy, hw: item.outer.w / 2, hh: item.outer.h / 2, angle: degToRad(item.rotation) });
    x0 = Math.min(x0, item.cx - hx);
    y0 = Math.min(y0, item.cy - hy);
    x1 = Math.max(x1, item.cx + hx);
    y1 = Math.max(y1, item.cy + hy);
  }
  return {
    cells,
    items,
    coverage: winner.metrics.coverage,
    score: winner.score,
    minShortSide: winner.metrics.minShort,
    bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    valid: true,
    overlapPairs: winner.metrics.overlapPairs,
    maxOverlapOfCap: winner.metrics.maxOverlapOfCap,
    hole: winner.metrics.hole,
    fallback: winner.fallback,
  };
}

/**
 * An independent check of the hard rules on a finished layout — for the tests
 * and the lab's red highlights. Counts every image any other item's outer rect
 * (plus the shadow margin) touches, every fastener outside its own frame band,
 * and every item whose rotated outline leaves the box.
 */
export function artsyViolations(
  layout: ArtsyLayout,
  box: CollageBox,
  shadowMargin = DEFAULT_ARTSY_TUNING.shadowMargin,
): { images: string[]; outOfBox: string[]; fasteners: string[] } {
  const margin = shadowMargin * Math.min(box.width, box.height);
  const outers = layout.items.map((item): Obb => ({
    cx: item.cx,
    cy: item.cy,
    hw: item.outer.w / 2,
    hh: item.outer.h / 2,
    angle: degToRad(item.rotation),
  }));
  const images = layout.items.map((item, i): Obb => {
    const o = outers[i];
    const { c, s } = cosSin(o.angle);
    const lx = item.image.x + item.image.w / 2 - item.outer.w / 2;
    const ly = item.image.y + item.image.h / 2 - item.outer.h / 2;
    return { cx: o.cx + lx * c - ly * s, cy: o.cy + lx * s + ly * c, hw: item.image.w / 2, hh: item.image.h / 2, angle: o.angle };
  });
  const hit = new Set<string>();
  const out = new Set<string>();
  const loose = new Set<string>();
  layout.items.forEach((item, i) => {
    const { hx, hy } = aabbHalf(outers[i]);
    const tol = 1e-6;
    if (item.cx - hx < -tol || item.cy - hy < -tol || item.cx + hx > box.width + tol || item.cy + hy > box.height + tol) out.add(item.photoId);
    layout.items.forEach((other, j) => {
      if (i !== j && satPush(images[i], inflate(outers[j], margin * (1 - 1e-6)), 0) !== null) hit.add(item.photoId);
    });
    for (const f of item.fasteners) {
      const pts = corners({ cx: f.x + f.w / 2, cy: f.y + f.h / 2, hw: f.w / 2, hh: f.h / 2, angle: degToRad(f.angle) });
      if (pts.some((p) => p.y > item.image.y + 1e-6 || p.y < -1e-6 || p.x < -1e-6 || p.x > item.outer.w + 1e-6)) loose.add(item.photoId);
    }
  });
  return { images: [...hit], outOfBox: [...out], fasteners: [...loose] };
}

/**
 * The Artsy style as a pagination engine (../paginate.ts): the layout options
 * are fixed by the collage's settings; effort and the minimum photo size come
 * from the pagination, which probes page counts with less effort than the one
 * layout it shows.
 */
export function artsyEngine(options: Partial<ArtsyOptions>): LayoutEngine {
  return (photos, box, paginate, seed) =>
    buildArtsyLayout(photos, box, { ...options, effort: paginate.effort, minShortFraction: paginate.minShortFraction }, seed);
}

/**
 * How Artsy pages are counted (spec §5.3): fewer photos than Clean, because
 * frames, tilt and backdrop take room — at most 10 — and a lower coverage bar,
 * because backdrop showing between prints is part of the look.
 */
export const ARTSY_PAGINATION: Partial<PaginateOptions> = {
  maxPerPage: 10,
  minCoverage: 0.7,
  minShortFraction: DEFAULT_ARTSY_OPTIONS.minShortFraction,
  densityRanges: { auto: [3, 8], few: [2, 4], medium: [4, 7], many: [7, 10] },
};
