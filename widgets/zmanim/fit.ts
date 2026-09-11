/*
 * `fit` mode for the Zmanim table, which does NOT mean what
 * docs/sizing.md §2's `fit` means, and the difference is the point.
 *
 * §2's fit is "the box is authoritative, content scales to fill it,
 * subject to a min and max" — a binary search for the largest size at
 * which the content fits BOTH axes. That is right for a title. It is wrong
 * for a table, because it makes the type size a function of how many rows
 * there happen to be today, and two of the canonical zmanim
 * (`candle_lighting`, `shabbos_ends`) are only there on some dates.
 *
 * THE RULES THIS IMPLEMENTS INSTEAD. Width is never compromised; height
 * may overflow:
 *
 *  1. Vertical resize drives the size. A taller box means bigger text.
 *  2. Horizontal resize does not, on its own. Widening a box that already
 *     had room changes nothing — and NEITHER DOES NARROWING ONE THAT STILL
 *     HAS ROOM, which is the half of this rule that was wrong until now.
 *  3. The TIMES are never clipped horizontally. If the box is too narrow
 *     for the time column at the height-driven size, the size comes down
 *     until it fits.
 *  4. Vertical overflow is acceptable. If there is height to grow into,
 *     grow — even when the list then no longer fits and has to scroll or
 *     page (./overflow.ts).
 *
 * So: `size = min(heightDriven, widthAllowed)`, clamped. Rule 1 is the
 * first term, rule 3 the second, rule 2 falls out of taking the min (a
 * wider box only ever raises the second term, and the first one caps it),
 * and rule 4 falls out of the first term not knowing the row count.
 *
 * WHAT "TOO NARROW" MEANS, WHICH IS THE FIX FOR A REAL REPORTED BUG:
 * "narrowing the box makes the font smaller." It did, over a huge range of
 * perfectly roomy widths, and the arithmetic below was never the reason —
 * `protectedWidthPerFontPx` was.
 *
 * The Renderer used to measure it as the whole grid's `max-content` width:
 * the widest label at full length, plus the gap, plus the widest time.
 * That is the table's IDEAL width, not its minimum, and rule 3 was reading
 * one as the other. So the type started shrinking the moment the box was
 * narrower than ideal — which on a realistic row (a 16-character label, a
 * `11:21 AM`, a 1em gap) is about 13× the type size, while the time column
 * itself needs about 5×. Every width in that 2.5× band shrank the type,
 * and not one of them would have clipped anything.
 *
 * What the second term protects now is the TIME COLUMN plus its gap, and
 * nothing else. The label column is a `1fr` track with `min-w-0
 * overflow-hidden` — it exists to absorb exactly this shortfall, and a
 * truncated label is what its clip has always been for. That is the trade
 * this makes explicit: in a box too narrow for the whole table, a long
 * label gets cut rather than the whole table getting smaller. On a board
 * read from twenty feet (design.md §1) that is the better of the two, and
 * it is the only reading under which narrowing a roomy box changes
 * nothing.
 *
 * NO BINARY SEARCH, because none is needed. For rows that do not wrap —
 * which the Renderer's own `Row` enforces, and which the paging mode
 * already depended on — both rendered width and rendered row height scale
 * LINEARLY with font size. So one measurement at any known size gives an
 * exact ratio, and the answer is arithmetic rather than fourteen
 * applications of a guess to the real DOM.
 *
 * WHAT THIS DOES TO THE SPACER ROWS, which is the thing to state before
 * reading any of the code: they are gone, and they had to go.
 *
 * Spacers existed to pad the measured list to the DECLARED selection count,
 * because the old fit's size depended on total content height and therefore
 * on the row count — so a returning candle-lighting row on Friday rescaled
 * the whole table. Neither term above contains the row count.
 * `rowHeightPerFontPx` is per-row by construction (total height over row
 * count), and the width term is one column's width. Padding the list would
 * now be worse than useless: a spacer inflates the content height the
 * overflow check reads, so a table that genuinely fits would scroll.
 *
 * AND THE DAY-TO-DAY WOBBLE IS GONE WITH IT. The old width term was
 * measured from the widest label present, so a Friday's "Candle Lighting"
 * could shrink a width-constrained table. The time column is the same
 * width on every date — all thirteen values are `H:MM AM/PM` in a face
 * with tabular figures (scripts/test-font-parity.mjs) — so the second term
 * no longer moves when a row appears or leaves.
 */

/**
 * How many rows a `fit`-mode box is sized to show at once.
 *
 * THE ONE JUDGEMENT CALL IN THIS FILE. Rule 1 says a taller box means
 * bigger text, and something has to say how much bigger — the row count
 * cannot, because rule 4 wants the size to hold when rows appear.
 *
 * Eight, from the geometry a board actually has: a zmanim table occupying
 * a third of a 1080-unit-tall board is 360 units, which at eight rows
 * gives roughly 45-unit type — legible from twenty feet, which is
 * design.md §1's whole brief. A shul that wants bigger type makes the box
 * taller; one that wants the whole list visible makes it taller still, or
 * uses `hug`.
 *
 * With fewer than eight rows selected the list does not fill the box, and
 * that is honest rather than a gap to close: `fixed` mode leaves the same
 * space, and closing it would mean the size depending on the row count
 * again.
 */
export const FIT_VISIBLE_ROWS = 8;

export type FitMeasurement = {
  /** The clipping box, in CSS pixels. */
  boxHeightPx: number;
  boxWidthPx: number;
  /**
   * The width the row CANNOT give up, per 1px of font size: the time
   * column plus the gap that separates it from the label, measured with
   * the font size that was actually applied when it was read.
   *
   * NOT the whole row's width, and the header above is why — that was the
   * bug. The label column is deliberately allowed to truncate, so its
   * width is not protected and does not belong in this number.
   *
   * Zero or negative means nothing measurable, and the width constraint is
   * skipped.
   */
  protectedWidthPerFontPx: number;
  /** One row's rendered height per 1px of font size — line-height and glyph
   *  metrics included, measured rather than assumed from a `leading-snug`
   *  constant that a class change could silently invalidate. */
  rowHeightPerFontPx: number;
};

/**
 * The font size, in CSS pixels, this box should render at.
 *
 * `minPx`/`maxPx` are the manifest's own bounds, already resolved to
 * pixels by the caller. The clamp is last, so a box too narrow to show
 * even a time at `minPx` settles there and clips — docs/sizing.md §3's
 * overflow case, and the one place rule 3 cannot be honoured because
 * nothing smaller is legible.
 */
export function fitFontSizePx(measurement: FitMeasurement, bounds: { minPx: number; maxPx: number }): number {
  const { boxHeightPx, boxWidthPx, protectedWidthPerFontPx, rowHeightPerFontPx } = measurement;
  const { minPx, maxPx } = bounds;

  // Rule 1. Nothing here reads the row count — that is rule 4.
  const heightDriven =
    rowHeightPerFontPx > 0 ? boxHeightPx / (FIT_VISIBLE_ROWS * rowHeightPerFontPx) : maxPx;

  // Rule 3. `Infinity` when there is nothing to measure, so the min below
  // falls through to the height-driven size rather than collapsing to zero.
  const widthAllowed =
    protectedWidthPerFontPx > 0 ? boxWidthPx / protectedWidthPerFontPx : Number.POSITIVE_INFINITY;

  // Rule 2 is this `min`: a wider box raises `widthAllowed` and the height
  // term caps the result, so widening past what the text needs changes
  // nothing at all — and so does narrowing, until the box reaches the one
  // column that is not allowed to give way.
  return Math.max(minPx, Math.min(maxPx, Math.min(heightDriven, widthAllowed)));
}
