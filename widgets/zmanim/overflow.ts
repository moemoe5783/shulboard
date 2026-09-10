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
 * Continuous-scroll speed, in board design units per second, per setting.
 *
 * IT USED TO BE A CONSTANT 16 AND THAT WAS TOO SLOW. The reasoning behind
 * 16 ("a little under three seconds per row") measured the wrong thing: what
 * matters at twenty feet is not how long a row takes to move its own height
 * but how long it is legibly on screen, and how long the whole list takes to
 * come round. At 16 a twelve-row list cycled in 31 seconds, which is long
 * enough that a congregant looking for one row gives up.
 *
 * `medium` is the default at 60 units per second, chosen from two numbers
 * rather than by feel:
 *
 *  - A ROW IS ON SCREEN FOR (box height + row height) / speed. In a
 *    400-unit box with 44-unit rows that is 7.4 seconds at 60 — comfortably
 *    longer than reading a label and a time takes, and the same order as
 *    the eight seconds a page holds in `page` mode.
 *  - THE WHOLE LIST COMES ROUND IN content height / speed. Twelve rows is
 *    504 units, so 8.4 seconds at 60 — again the same order as one page
 *    step. The two modes therefore show a congregant everything in about
 *    the same time, which is what makes the choice between them about
 *    preference rather than about patience.
 *
 * `slow` halves it for a shul that wants a calmer board; `fast` doubles it
 * for a long list where coming round quickly matters more than dwell time.
 */
export const SCROLL_UNITS_PER_SECOND = { slow: 30, medium: 60, fast: 120 } as const;

export type ScrollSpeed = keyof typeof SCROLL_UNITS_PER_SECOND;

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
 * `elapsedSeconds` is derived from the master tick (lib/tick.ts), which is
 * still the ONLY clock either mode uses — plan.md §3e: "one master
 * rAF/second-tick that all time widgets subscribe to. No setInterval
 * accumulation." A display route runs for months, so a widget with its own
 * interval leaks one timer per remount until the TV WebView dies at 3am.
 * Deriving elapsed time from that tick is arithmetic in the caller, not a
 * second clock.
 *
 * `null` for `elapsedSeconds` is the server render and the frame before
 * hydration; zero heights are the same frame. Both read as "nothing
 * overflows", which is the right first frame — a still, complete table —
 * and the client corrects it once measured. Same class of gap as Clock's
 * `second === null` placeholder.
 */
export function overflowState(input: {
  mode: OverflowMode;
  /**
   * SECONDS SINCE THIS WIDGET STARTED SCROLLING, not the absolute master
   * tick — and the difference was a real, visible bug rather than tidiness.
   *
   * This used to take the raw epoch second. `(second * speed) % height` is
   * in range, so nothing looked wrong, but its value at any given moment is
   * arbitrary: the frame before measurement has no offset at all, and the
   * first frame after it jumps straight to whatever the epoch happens to
   * produce. Measured with the old 16 units/second and a 504-unit list, the
   * first target was 224px — so CSS interpolated 0 to 224 over one second,
   * a fourteen-times-speed sweep through most of the list, and then settled
   * to 16px per second, which reads as stopping. Exactly the "scrolls very
   * fast then slows almost to a stop" this was reported as.
   *
   * Elapsed time makes the first frame's offset zero by construction. The
   * caller resets the origin whenever the measurement changes too, so a
   * resize restarts the scroll from the top rather than jumping to a new
   * arbitrary point in the cycle.
   */
  elapsedSeconds: number | null;
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
  /** Which speed the shul picked — `config.scrollSpeed`. */
  speed: ScrollSpeed;
}): OverflowState {
  const { mode, elapsedSeconds, boxHeight, contentHeight, rowCount, boxWidth, canvasWidth, speed } = input;

  // A pixel of slack: an auto-height flex box can measure a fraction past
  // its own client height from line-height rounding alone, and treating
  // that as overflow would set a whole table scrolling for nothing. Same
  // reasoning as BoardRenderer's own overflow check.
  const overflowing = boxHeight > 0 && contentHeight > boxHeight + 1;
  if (!overflowing || elapsedSeconds === null || mode === "clip") {
    return { ...STILL, overflowing };
  }

  if (mode === "scroll") {
    // Design units to CSS pixels: the scroll rate has to mean the same
    // thing on a 1920 board in a lobby and on the same board at 33% in the
    // editor, and the measured heights are already in rendered pixels.
    const pixelsPerSecond = (SCROLL_UNITS_PER_SECOND[speed] / canvasWidth) * (boxWidth || canvasWidth);
    const offset = (elapsedSeconds * pixelsPerSecond) % contentHeight;
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
  const page = Math.floor(elapsedSeconds / PAGE_SECONDS) % pages;

  return {
    overflowing,
    offset: page * rowsPerPage * rowHeight,
    animate: false,
    wrapped: false,
    rowsPerPage,
    pages,
  };
}
