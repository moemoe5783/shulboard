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
  /**
   * How long one full cycle of a continuous scroll takes, in seconds — the
   * `animation-duration` the Renderer hands to CSS. Zero for every other
   * mode and whenever nothing overflows.
   *
   * A DURATION RATHER THAN A PER-TICK OFFSET, and that is the fix for
   * "the scroll runs through the list, stops, then restarts." See the
   * scroll branch below.
   */
  scrollSeconds: number;
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
  scrollSeconds: 0,
  rowsPerPage: 0,
  pages: 1,
};

/**
 * Where the row list should sit right now, or how fast it should cycle.
 *
 * `elapsedSeconds` is derived from the master tick (lib/tick.ts), which is
 * still the ONLY clock either mode uses — plan.md §3e: "one master
 * rAF/second-tick that all time widgets subscribe to. No setInterval
 * accumulation." A display route runs for months, so a widget with its own
 * interval leaks one timer per remount until the TV WebView dies at 3am.
 * Deriving elapsed time from that tick is arithmetic in the caller, not a
 * second clock.
 *
 * Only `page` reads the tick at all now. `scroll` returns a duration for
 * CSS to run (see its branch) and reads no clock, so the tick above is
 * `page`'s alone.
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
   * SECONDS SINCE THIS WIDGET STARTED PAGING, not the absolute master tick.
   *
   * `page` is the only mode that reads it now, and elapsed time is what
   * makes it start on page one rather than on whichever page the wall clock
   * happens to land on. The caller resets its origin whenever the
   * measurement changes, so a resize restarts from the top.
   *
   * `scroll` used to read it too, and a real bug lived there: the offset
   * came from the absolute epoch second, so the first measured frame jumped
   * to an arbitrary point in the list and CSS interpolated the whole
   * distance over one second (measured: 224px at the old 16 units/second on
   * a 504-unit list — a fourteen-times sweep, then a settle to the real
   * rate, which reads as stopping). Taking an elapsed time fixed the
   * startup; it could not fix the seam, because one target per second plus
   * a one-second transition cannot express both a wrap and the next
   * second's motion in the same frame. Scroll is a CSS animation now and
   * reads no clock at all — see the scroll branch.
   *
   * `null` is the server render and the frame before hydration.
   */
  elapsedSeconds: number | null;
  /** The clipping box's own height, in CSS pixels. */
  boxHeight: number;
  /** The full row list's height, in CSS pixels. */
  contentHeight: number;
  /** Rows in the list. There are no spacers any more — ./fit.ts says why. */
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
  if (!overflowing || mode === "clip") {
    return { ...STILL, overflowing };
  }

  if (mode === "scroll") {
    // Design units to CSS pixels: the scroll rate has to mean the same
    // thing on a 1920 board in a lobby and on the same board at 33% in the
    // editor, and the measured heights are already in rendered pixels.
    /*
     * THE SPEED IS DEFAULTED HERE, not just in the manifest, and that is a
     * real case rather than defensive noise. A widget's config reaches a
     * Renderer UNVALIDATED — lib/board-doc.ts keeps it an opaque
     * `Record<string, unknown>` so the board schema never has to know about
     * every widget's fields — so a document saved before `scrollSpeed`
     * existed arrives with it undefined. Indexing the table with that gives
     * `undefined`, and the arithmetic below then produces NaN, which reaches
     * CSS as an invalid value and stops the list dead with nothing to see or
     * log. The manifest's own default only applies to config written
     * through it.
     */
    const unitsPerSecond = SCROLL_UNITS_PER_SECOND[speed] ?? SCROLL_UNITS_PER_SECOND.medium;
    const pixelsPerSecond = (unitsPerSecond / canvasWidth) * (boxWidth || canvasWidth);
    /*
     * ONE CYCLE'S DURATION, NOT THIS SECOND'S OFFSET — and this is the fix
     * for "it runs through the list, stops, then restarts."
     *
     * The old shape was `offset = (elapsed × pixelsPerSecond) %
     * contentHeight`, transitioned over one second, with the transition
     * suppressed on the frame the modulo reset (`wrapped`). That cannot be
     * seamless, and the reason is the one-second lag: a transition set at
     * tick T is still travelling to its target when T+1 arrives, so at the
     * wrap the element is sitting at `contentHeight − pixelsPerSecond`
     * while the tick hands it `≈ pixelsPerSecond` with no transition. It
     * snaps forward instantly and then stands still for a whole second
     * before the next transition starts — measured at the default speed on
     * a twelve-row list, a 60px skip followed by a one-second freeze. A
     * single value per second can be the wrap OR the next second's motion,
     * never both.
     *
     * A CSS animation has no such frame. The Renderer renders the list
     * twice (the seam) and animates the pair from `translateY(0)` to
     * `translateY(-50%)`, linear and infinite: minus fifty percent of a
     * two-copy stack is exactly one copy, so the end state is
     * pixel-identical to the start and the loop closes with nothing to
     * suppress. The keyframes are in app/globals.css.
     *
     * THIS IS STILL NOT A TIMER, which is what plan.md §3e's rule is
     * about: nothing accumulates, nothing needs clearing on unmount, and
     * the browser drives it off the compositor rather than off a clock this
     * widget owns. It is less machinery than the tick version, not more —
     * scroll now reads no clock at all, and `offset` stays zero.
     */
    const scrollSeconds = pixelsPerSecond > 0 ? contentHeight / pixelsPerSecond : 0;
    return {
      overflowing,
      offset: 0,
      animate: scrollSeconds > 0,
      scrollSeconds,
      rowsPerPage: rowCount,
      pages: 1,
    };
  }

  // `page` is the one mode that needs the tick, so this is where the
  // pre-hydration frame stops: a still, complete table until the first
  // second arrives.
  if (elapsedSeconds === null) return { ...STILL, overflowing };

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
    scrollSeconds: 0,
    rowsPerPage,
    pages,
  };
}
