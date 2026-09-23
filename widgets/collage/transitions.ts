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
 * ONE BY ONE. The sequential modes take photos out in reading order (top to
 * bottom, left to right), then bring the new ones in the same way, the next
 * page starting while the last few of the old are still leaving so the motion
 * never stalls. The stagger shrinks as a page gets busier, so fourteen photos
 * don't take four times as long as four.
 */

export const COLLAGE_TRANSITIONS = ["cascade", "rise", "zoom", "slide", "crossfade", "fade", "none"] as const;
export type CollageTransition = (typeof COLLAGE_TRANSITIONS)[number];

export const TRANSITION_LABELS: Record<CollageTransition, string> = {
  cascade: "One by one — fade",
  rise: "One by one — rise",
  zoom: "One by one — zoom",
  slide: "One by one — slide",
  crossfade: "Crossfade the whole page",
  fade: "Fade through the background",
  none: "None",
};

const SEQUENTIAL = new Set<CollageTransition>(["cascade", "rise", "zoom", "slide"]);

/** How long one photo takes to arrive, and to leave. */
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

function step(count: number, spread: number, most: number): number {
  return count <= 1 ? 0 : Math.min(most, spread / (count - 1));
}

function leaveSpan(mode: CollageTransition, count: number): number {
  if (count === 0) return 0;
  if (SEQUENTIAL.has(mode)) return (count - 1) * step(count, LEAVE_SPREAD_MS, 90) + LEAVE_MS;
  if (mode === "fade") return PAGE_MS / 2;
  if (mode === "crossfade") return PAGE_MS;
  return 0;
}

/** When the new page starts arriving, in ms after the swap. */
export function enterOffset(mode: CollageTransition, leavingCount: number): number {
  if (leavingCount === 0 || mode === "none" || mode === "crossfade") return 0;
  if (mode === "fade") return PAGE_MS / 2;
  return leaveSpan(mode, leavingCount) * HANDOFF;
}

/** The whole transition, from the swap until the last photo has settled. */
export function transitionTotal(mode: CollageTransition, leavingCount: number, enteringCount: number): number {
  if (mode === "none") return 0;
  const enterSpan = SEQUENTIAL.has(mode)
    ? (Math.max(1, enteringCount) - 1) * step(enteringCount, ENTER_SPREAD_MS, 140) + ENTER_MS
    : mode === "fade"
      ? PAGE_MS / 2
      : PAGE_MS;
  return Math.max(leaveSpan(mode, leavingCount), enterOffset(mode, leavingCount) + enterSpan);
}

/**
 * The CSS animation for the photo at position `order` (reading order) of a
 * page of `count`, arriving or leaving. `offset` delays an arrival until the
 * old page has made room. Undefined for no animation.
 */
export function cellAnimation(
  mode: CollageTransition,
  role: "entering" | "leaving",
  order: number,
  count: number,
  offset: number,
): string | undefined {
  if (mode === "none") return undefined;
  if (role === "leaving") {
    if (mode === "crossfade") return `collage-out ${PAGE_MS}ms ease both`;
    if (mode === "fade") return `collage-out ${PAGE_MS / 2}ms ease both`;
    const delay = order * step(count, LEAVE_SPREAD_MS, 90);
    return `collage-${mode}-out ${LEAVE_MS}ms ${EASE_OUT} ${Math.round(delay)}ms both`;
  }
  if (mode === "crossfade") return `collage-in ${PAGE_MS}ms ease both`;
  if (mode === "fade") return `collage-in ${PAGE_MS / 2}ms ease ${Math.round(offset)}ms both`;
  const delay = offset + order * step(count, ENTER_SPREAD_MS, 140);
  return `collage-${mode}-in ${ENTER_MS}ms ${EASE_IN} ${Math.round(delay)}ms both`;
}

/** Each cell's position in reading order: top to bottom, then left to right.
 *  Rows are matched loosely, since cells in one visual row can start a hair
 *  apart in a guillotine layout. */
export function readingOrder(cells: readonly { top: number; left: number }[]): number[] {
  const indices = cells.map((_, i) => i);
  indices.sort((a, b) => {
    const dy = cells[a].top - cells[b].top;
    if (Math.abs(dy) > 2) return dy;
    return cells[a].left - cells[b].left;
  });
  const order = new Array<number>(cells.length);
  indices.forEach((cellIndex, position) => {
    order[cellIndex] = position;
  });
  return order;
}
