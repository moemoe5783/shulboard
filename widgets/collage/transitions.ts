import { createRng, hashSeed, shuffled } from "@/lib/collage/random";

/*
 * How a collage moves from one page to the next — the timeline both the
 * Renderer (which animates each photo) and the player (which removes the old
 * page once it's gone) read, so they can never disagree about when a
 * transition is over.
 *
 * NOTHING POPS. Every mode animates the outgoing page AWAY as well as the new
 * one in; the old page is only removed from the DOM after its last photo has
 * finished leaving. A new page usually has a different arrangement, so its
 * gaps fall where the old photos were — if the old page stayed at full opacity
 * underneath and vanished at the end, the frame's background would appear in
 * those gaps with a jump after the new photos were already in.
 *
 * PHOTO BY PHOTO is the default for every effect: photos leave one after
 * another, then the new ones arrive the same way, the next page starting while
 * the last few of the old are still leaving so the motion never stalls. The
 * ORDER is a setting (top to bottom, random, from the centre out); random is
 * seeded by the page, so the editor and every screen play the same order. Only
 * the two whole-page modes move every photo at once, and their names say so.
 *
 * SPEED scales every duration and every stagger together, so a faster setting
 * is the same choreography, quicker — not a different one.
 */

export const COLLAGE_TRANSITIONS = ["cascade", "rise", "zoom", "slide", "crossfade", "fade", "none"] as const;
export type CollageTransition = (typeof COLLAGE_TRANSITIONS)[number];

export const TRANSITION_LABELS: Record<CollageTransition, string> = {
  cascade: "Fade",
  rise: "Rise",
  zoom: "Zoom",
  slide: "Slide",
  crossfade: "Crossfade the whole page",
  fade: "Fade the whole page through the background",
  none: "None",
};

export const TRANSITION_ORDERS = ["reading", "random", "center"] as const;
export type TransitionOrder = (typeof TRANSITION_ORDERS)[number];

export const TRANSITION_ORDER_LABELS: Record<TransitionOrder, string> = {
  reading: "Top to bottom",
  random: "Random",
  center: "From the centre out",
};

/** The speed range the settings slider offers: 0.5× is half as fast. */
export const TRANSITION_SPEED_MIN = 0.5;
export const TRANSITION_SPEED_MAX = 2.5;

const PER_PHOTO = new Set<CollageTransition>(["cascade", "rise", "zoom", "slide"]);

/** Whether a mode moves photos one after another (so order matters). */
export function isPerPhoto(mode: CollageTransition): boolean {
  return PER_PHOTO.has(mode);
}

/** At 1× speed: how long one photo takes to arrive, and to leave. */
const ENTER_MS = 650;
const LEAVE_MS = 450;
/** The whole sequence of arrivals spans at most this (plus one photo's own time). */
const ENTER_SPREAD_MS = 900;
const LEAVE_SPREAD_MS = 600;
/** The new page starts once this much of the old page's exit has run. */
const HANDOFF = 0.55;
/** Whole-page modes. */
const PAGE_MS = 900;

const EASE_IN = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_OUT = "cubic-bezier(0.55, 0, 0.75, 0.3)";

function clampSpeed(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? Math.min(TRANSITION_SPEED_MAX, Math.max(TRANSITION_SPEED_MIN, speed)) : 1;
}

function step(count: number, spread: number, most: number): number {
  return count <= 1 ? 0 : Math.min(most, spread / (count - 1));
}

function leaveSpan(mode: CollageTransition, count: number): number {
  if (count === 0) return 0;
  if (PER_PHOTO.has(mode)) return (count - 1) * step(count, LEAVE_SPREAD_MS, 90) + LEAVE_MS;
  if (mode === "fade") return PAGE_MS / 2;
  if (mode === "crossfade") return PAGE_MS;
  return 0;
}

/** When the new page starts arriving, in ms after the swap. */
export function enterOffset(mode: CollageTransition, leavingCount: number, speed = 1): number {
  if (leavingCount === 0 || mode === "none" || mode === "crossfade") return 0;
  const s = clampSpeed(speed);
  if (mode === "fade") return PAGE_MS / 2 / s;
  return (leaveSpan(mode, leavingCount) * HANDOFF) / s;
}

/** The whole transition, from the swap until the last photo has settled. */
export function transitionTotal(mode: CollageTransition, leavingCount: number, enteringCount: number, speed = 1): number {
  if (mode === "none") return 0;
  const s = clampSpeed(speed);
  const enterSpan = PER_PHOTO.has(mode)
    ? (Math.max(1, enteringCount) - 1) * step(enteringCount, ENTER_SPREAD_MS, 140) + ENTER_MS
    : mode === "fade"
      ? PAGE_MS / 2
      : PAGE_MS;
  return Math.max(leaveSpan(mode, leavingCount) / s, enterOffset(mode, leavingCount, s) + enterSpan / s);
}

/**
 * The CSS animation for the photo at position `order` of a page of `count`,
 * arriving or leaving. `offset` (already speed-scaled) delays an arrival until
 * the old page has made room. Undefined for no animation.
 */
export function cellAnimation(
  mode: CollageTransition,
  role: "entering" | "leaving",
  order: number,
  count: number,
  offset: number,
  speed = 1,
): string | undefined {
  if (mode === "none") return undefined;
  const s = clampSpeed(speed);
  const ms = (value: number) => `${Math.round(value / s)}ms`;
  if (role === "leaving") {
    if (mode === "crossfade") return `collage-out ${ms(PAGE_MS)} ease both`;
    if (mode === "fade") return `collage-out ${ms(PAGE_MS / 2)} ease both`;
    const delay = order * step(count, LEAVE_SPREAD_MS, 90);
    return `collage-${mode}-out ${ms(LEAVE_MS)} ${EASE_OUT} ${ms(delay)} both`;
  }
  if (mode === "crossfade") return `collage-in ${ms(PAGE_MS)} ease both`;
  if (mode === "fade") return `collage-in ${ms(PAGE_MS / 2)} ease ${Math.round(offset)}ms both`;
  const delay = order * step(count, ENTER_SPREAD_MS, 140);
  return `collage-${mode}-in ${ms(ENTER_MS)} ${EASE_IN} ${Math.round(offset + delay / s)}ms both`;
}

type Placed = { top: number; left: number; width: number; height: number };

/** Each cell's position in the sequence (0 goes first).
 *  - reading: top to bottom, then left to right (rows matched loosely, since
 *    cells in one visual row can start a hair apart in a guillotine layout);
 *  - center: nearest the middle of the box first, spreading outward;
 *  - random: a shuffle seeded by `seed` — the same on every screen. */
export function sequenceOrder(cells: readonly Placed[], order: TransitionOrder, seed: string): number[] {
  const indices = cells.map((_, i) => i);
  if (order === "random") {
    return invert(shuffled(indices, createRng(hashSeed("transition-order", seed))));
  }
  if (order === "center") {
    const distance = (cell: Placed) => Math.hypot(cell.left + cell.width / 2 - 50, cell.top + cell.height / 2 - 50);
    indices.sort((a, b) => distance(cells[a]) - distance(cells[b]) || a - b);
    return invert(indices);
  }
  indices.sort((a, b) => {
    const dy = cells[a].top - cells[b].top;
    if (Math.abs(dy) > 2) return dy;
    return cells[a].left - cells[b].left;
  });
  return invert(indices);
}

/** A list of cell indices in play order -> each cell's position in it. */
function invert(sequence: readonly number[]): number[] {
  const position = new Array<number>(sequence.length);
  sequence.forEach((cellIndex, at) => {
    position[cellIndex] = at;
  });
  return position;
}

/** Kept for callers that only want reading order. */
export function readingOrder(cells: readonly Placed[]): number[] {
  return sequenceOrder(cells, "reading", "");
}
