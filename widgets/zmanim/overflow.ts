/*
 * What happens to zmanim rows that don't fit the box — `scroll`, `page` or
 * `clip`.
 *
 * A PURE FUNCTION IN ITS OWN MODULE, deliberately, because everything
 * interesting here is arithmetic over four measured numbers and a tick,
 * and a component is a bad place to keep arithmetic nobody can drive
 * directly. scripts/test-zmanim-overflow.ts exercises it with no DOM.
 *
 * The measurement itself stays in the Renderer (a ResizeObserver over the
 * box and the content), because how tall a rendered row is is a fact about
 * pixels that only the browser has.
 */

/**
 * Seconds a page holds before the plain swap to the next.
 *
 * Eight, the same number candle lighting's rotate uses and for the same
 * reason: a congregant glancing up needs long enough to read a label and a
 * time and register that the block changed, and anything much faster reads
 * as flicker rather than as paging.
 */
export const PAGE_SECONDS = 8;

/**
 * Continuous-scroll speed, in board design units per second.
 *
 * Slow on purpose. A row is roughly 1.4 times its type size tall, so at
 * the default 32-unit type this is a little under three seconds per row —
 * enough that a congregant reading one row is not chasing it. Not
 * configurable: a speed control is a setting nobody can judge without
 * standing in the lobby, and the wrong value looks broken in both
 * directions.
 */
export const SCROLL_UNITS_PER_SECOND = 16;

export type OverflowMode = "page" | "scroll" | "clip";

export type OverflowState = {
  /** True only when the rows genuinely don't fit. Both moving modes are
   *  INERT otherwise, which is what lets `page` be the default without
   *  putting motion on boards that don't need it. */
  overflowing: boolean;
  /** CSS pixels to translate the list up by. */
  offset: number;
  /** Whether the translate should be transitioned. Only ever true for
   *  `scroll` — `page` is a plain swap, per design.md's motion rule. */
  animate: boolean;
  /** The one frame a scroll resets to the top on, where the transition has
   *  to be suppressed or CSS animates the whole list backwards. */
  wrapped: boolean;
  /** How many rows fit at once. Reported for the tests and for a future
   *  editor affordance; the offset already accounts for it. */
  rowsPerPage: number;
  /** How many pages the rows divide into. 1 when nothing overflows. */
  pages: number;
};

const STILL: OverflowState = {
  overflowing: false,
  offset: 0,
  animate: false,
  wrapped: false,
  rowsPerPage: 0,
  pages: 1,
};

/**
 * Where the row list should sit right now.
 *
 * `second` is the master tick (lib/tick.ts) and is the ONLY clock either
 * mode uses — plan.md §3e: "one master rAF/second-tick that all time
 * widgets subscribe to. No setInterval accumulation." A display route runs
 * for months, so a widget with its own interval leaks one timer per
 * remount until the TV WebView dies at 3am.
 *
 * `null` for `second` is the server render and the frame before hydration;
 * zero heights are the same frame. Both read as "nothing overflows", which
 * is the right first frame — a still, complete table — and the client
 * corrects it once measured. Same class of gap as Clock's `second === null`
 * placeholder.
 */
export function overflowState(input: {
  mode: OverflowMode;
  second: number | null;
  /** The clipping box's own height, in CSS pixels. */
  boxHeight: number;
  /** The full row list's height, in CSS pixels. */
  contentHeight: number;
  /** Rows in the list, spacers included — see the Renderer's `spacerCount`. */
  rowCount: number;
  /** The box's rendered width, for converting the scroll rate out of board
   *  design units. Falls back to `canvasWidth`, i.e. 1:1. */
  boxWidth: number;
  canvasWidth: number;
}): OverflowState {
  const { mode, second, boxHeight, contentHeight, rowCount, boxWidth, canvasWidth } = input;

  // A pixel of slack: an auto-height flex box can measure a fraction past
  // its own client height from line-height rounding alone, and treating
  // that as overflow would set a whole table scrolling for nothing. Same
  // reasoning as BoardRenderer's own overflow check.
  const overflowing = boxHeight > 0 && contentHeight > boxHeight + 1;
  if (!overflowing || second === null || mode === "clip") {
    return { ...STILL, overflowing };
  }

  if (mode === "scroll") {
    // Design units to CSS pixels: the scroll rate has to mean the same
    // thing on a 1920 board in a lobby and on the same board at 33% in the
    // editor, and the measured heights are already in rendered pixels.
    const pixelsPerSecond = (SCROLL_UNITS_PER_SECOND / canvasWidth) * (boxWidth || canvasWidth);
    const offset = (second * pixelsPerSecond) % contentHeight;
    /*
     * THE SEAM, derived rather than remembered. The offset has just
     * wrapped when it is less than one second's travel from the top —
     * which is exactly the frame the CSS transition must be off for, or it
     * animates the whole list backwards over a second. Computed from the
     * tick instead of compared against a ref, so nothing is read during a
     * render that a previous render wrote.
     *
     * The list itself is rendered twice by the Renderer, so the moment the
     * offset reaches the first copy's full height what is on screen is
     * pixel-identical to the offset being zero — which is what makes the
     * reset invisible rather than merely un-animated.
     */
    return {
      overflowing,
      offset,
      animate: true,
      wrapped: offset < pixelsPerSecond,
      rowsPerPage: rowCount,
      pages: 1,
    };
  }

  // Whole rows, never a row cut in half. Rows are uniform height (the
  // Renderer's `Row` refuses to wrap, which is what makes this true), so
  // one row's height is the measured content over the row count — no
  // per-row measurement needed.
  const rowHeight = contentHeight / Math.max(1, rowCount);
  const rowsPerPage = Math.max(1, Math.floor(boxHeight / rowHeight));
  const pages = Math.max(1, Math.ceil(rowCount / rowsPerPage));
  const page = Math.floor(second / PAGE_SECONDS) % pages;

  return {
    overflowing,
    offset: page * rowsPerPage * rowHeight,
    animate: false,
    wrapped: false,
    rowsPerPage,
    pages,
  };
}
