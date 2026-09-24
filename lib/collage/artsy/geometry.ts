/*
 * Rotated-rectangle maths for the Artsy collage — pure numbers, no DOM.
 *
 * Every item is an oriented box (OBB): a centre, two half-extents along its own
 * axes, and an angle. Two OBBs intersect exactly when no separating axis exists
 * among their four edge normals (the Separating Axis Theorem), and the smallest
 * overlap along those axes is the push that separates them — which is what the
 * layout's relaxation step uses.
 */

export type Vec = { x: number; y: number };

/** A rectangle rotated about its own centre. `angle` in radians. */
export type Obb = { cx: number; cy: number; hw: number; hh: number; angle: number };

export const degToRad = (deg: number) => (deg * Math.PI) / 180;

/*
 * cos and sin that come out bit-identical on every JavaScript engine.
 *
 * The layout has to be the same in the editor and on every screen (spec §2.5),
 * and Math.sin/Math.cos are not required to agree to the last bit between
 * engines — a one-ulp difference early in an iterative solver can end in a
 * different arrangement. Collage tilts are small (under 15°), where a short
 * Taylor series is exact to double precision using only + − × ÷, which IEEE
 * rounds identically everywhere. Larger angles fall back to Math (none occur).
 */
export function cosSin(angle: number): { c: number; s: number } {
  if (Math.abs(angle) > 0.5) return { c: Math.cos(angle), s: Math.sin(angle) };
  const x2 = angle * angle;
  // To x^14 / x^15: the next terms are below 1e-17 for |x| ≤ 0.5.
  const c = 1 - (x2 / 2) * (1 - (x2 / 12) * (1 - (x2 / 30) * (1 - (x2 / 56) * (1 - (x2 / 90) * (1 - (x2 / 132) * (1 - x2 / 182))))));
  const s = angle * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - (x2 / 156) * (1 - x2 / 210)))))));
  return { c, s };
}

/** The four corners, clockwise from the top left. */
export function corners(box: Obb): Vec[] {
  const { c, s } = cosSin(box.angle);
  const ux = { x: c * box.hw, y: s * box.hw };
  const uy = { x: -s * box.hh, y: c * box.hh };
  return [
    { x: box.cx - ux.x - uy.x, y: box.cy - ux.y - uy.y },
    { x: box.cx + ux.x - uy.x, y: box.cy + ux.y - uy.y },
    { x: box.cx + ux.x + uy.x, y: box.cy + ux.y + uy.y },
    { x: box.cx - ux.x + uy.x, y: box.cy - ux.y + uy.y },
  ];
}

/** The axis-aligned bounding box's half-extents: W'/2 = hw|cos| + hh|sin|, … */
export function aabbHalf(box: Obb): { hx: number; hy: number } {
  const t = cosSin(box.angle);
  const c = Math.abs(t.c);
  const s = Math.abs(t.s);
  return { hx: box.hw * c + box.hh * s, hy: box.hw * s + box.hh * c };
}

/** Whether the whole rotated outline sits inside a W×H box (with a hair of slack). */
export function insideBox(box: Obb, width: number, height: number, eps = 1e-6): boolean {
  const { hx, hy } = aabbHalf(box);
  return box.cx - hx >= -eps && box.cy - hy >= -eps && box.cx + hx <= width + eps && box.cy + hy <= height + eps;
}

function project(points: readonly Vec[], axis: Vec): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/**
 * SAT between two OBBs. Null when they don't touch (overlap ≤ `eps` on some
 * axis); otherwise the minimum translation vector that would push `a` clear of
 * `b` — its direction points from b towards a.
 */
export function satPush(a: Obb, b: Obb, eps = 1e-9): Vec | null {
  const pa = corners(a);
  const pb = corners(b);
  let best = Infinity;
  let axisBest: Vec = { x: 0, y: 0 };
  const ta = cosSin(a.angle);
  const tb = cosSin(b.angle);
  // Each box's two edge normals — its x axis and its y axis.
  const axes: Vec[] = [
    { x: ta.c, y: ta.s },
    { x: -ta.s, y: ta.c },
    { x: tb.c, y: tb.s },
    { x: -tb.s, y: tb.c },
  ];
  for (const axis of axes) {
    const [a0, a1] = project(pa, axis);
    const [b0, b1] = project(pb, axis);
    const overlap = Math.min(a1, b1) - Math.max(a0, b0);
    if (overlap <= eps) return null;
    if (overlap < best) {
      best = overlap;
      axisBest = axis;
    }
  }
  // Point the push from b to a.
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  const sign = dx * axisBest.x + dy * axisBest.y < 0 ? -1 : 1;
  return { x: axisBest.x * best * sign, y: axisBest.y * best * sign };
}

/** Whether two OBBs intersect (touching edges don't count). */
export function intersects(a: Obb, b: Obb, eps = 1e-9): boolean {
  return satPush(a, b, eps) !== null;
}

/** The OBB grown by `m` on every side. */
export function inflate(box: Obb, m: number): Obb {
  return { ...box, hw: box.hw + m, hh: box.hh + m };
}

/** Convex polygon clipping (Sutherland–Hodgman) — for the overlap area. */
function clip(subject: Vec[], a: Vec, b: Vec): Vec[] {
  const out: Vec[] = [];
  const inside = (p: Vec) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
  const cross = (p: Vec, q: Vec): Vec => {
    const a1 = b.y - a.y;
    const b1 = a.x - b.x;
    const c1 = a1 * a.x + b1 * a.y;
    const a2 = q.y - p.y;
    const b2 = p.x - q.x;
    const c2 = a2 * p.x + b2 * p.y;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-12) return p;
    return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
  };
  for (let i = 0; i < subject.length; i += 1) {
    const p = subject[i];
    const q = subject[(i + 1) % subject.length];
    const pin = inside(p);
    const qin = inside(q);
    if (pin && qin) out.push(q);
    else if (pin && !qin) out.push(cross(p, q));
    else if (!pin && qin) out.push(cross(p, q), q);
  }
  return out;
}

function polygonArea(points: readonly Vec[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

/** The area two OBBs share. */
export function overlapArea(a: Obb, b: Obb): number {
  if (!intersects(a, b)) return 0;
  let poly = corners(a);
  const clipper = corners(b);
  for (let i = 0; i < clipper.length && poly.length > 0; i += 1) {
    poly = clip(poly, clipper[i], clipper[(i + 1) % clipper.length]);
  }
  return poly.length >= 3 ? polygonArea(poly) : 0;
}

/** Whether a point is inside an OBB. */
export function containsPoint(box: Obb, x: number, y: number): boolean {
  const { c, s } = cosSin(box.angle);
  const dx = x - box.cx;
  const dy = y - box.cy;
  return Math.abs(dx * c + dy * s) <= box.hw && Math.abs(-dx * s + dy * c) <= box.hh;
}

/** A point in an item's own (unrotated, centred) frame, placed on the board. */
export function toWorld(box: Obb, lx: number, ly: number): Vec {
  const { c, s } = cosSin(box.angle);
  return { x: box.cx + lx * c - ly * s, y: box.cy + lx * s + ly * c };
}

/**
 * An OBB with its corners and axes worked out once — the relaxation loop tests
 * each shape against many others, and recomputing corners per test was most of
 * the layout's time.
 */
export type Prepared = { box: Obb; pts: Vec[]; axes: [Vec, Vec] };

export function prepare(box: Obb): Prepared {
  const { c, s } = cosSin(box.angle);
  return { box, pts: corners(box), axes: [{ x: c, y: s }, { x: -s, y: c }] };
}

/** satPush on prepared shapes — identical result, a fraction of the work. */
export function satPushPrepared(a: Prepared, b: Prepared, eps = 1e-9): Vec | null {
  let best = Infinity;
  let axisBest: Vec = a.axes[0];
  for (let k = 0; k < 4; k += 1) {
    const axis = k < 2 ? a.axes[k] : b.axes[k - 2];
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (let p = 0; p < 4; p += 1) {
      const da = a.pts[p].x * axis.x + a.pts[p].y * axis.y;
      if (da < a0) a0 = da;
      if (da > a1) a1 = da;
      const db = b.pts[p].x * axis.x + b.pts[p].y * axis.y;
      if (db < b0) b0 = db;
      if (db > b1) b1 = db;
    }
    const overlap = Math.min(a1, b1) - Math.max(a0, b0);
    if (overlap <= eps) return null;
    if (overlap < best) {
      best = overlap;
      axisBest = axis;
    }
  }
  const dx = a.box.cx - b.box.cx;
  const dy = a.box.cy - b.box.cy;
  const sign = dx * axisBest.x + dy * axisBest.y < 0 ? -1 : 1;
  return { x: axisBest.x * best * sign, y: axisBest.y * best * sign };
}
