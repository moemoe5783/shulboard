/*
 * `fit` mode for the Zmanim table.
 *
 * WIDTH FITS, HEIGHT SCROLLS. This is the whole rule, and it is deliberately
 * simpler than docs/sizing.md §2's general `fit` (a binary search for the
 * largest size that fits BOTH axes). A zmanim table is a column of rows that
 * grows and shrinks with the date — two of the canonical zmanim
 * (`candle_lighting`, `shabbos_ends`) are only present on some days — so
 * letting height drive the size would rescale the whole table every Friday.
 * Height is handled by scrolling/paging (./overflow.ts) instead, and never by
 * resizing the type.
 *
 * THE RULES:
 *
 *  1. WIDTH DRIVES THE SIZE. The type is as large as it can be while the
 *     widest row's full text — label, gap and time together — still fits
 *     the box's width. A wider box means bigger text; a narrower box means
 *     smaller text.
 *  2. HEIGHT IS IGNORED. Dragging the box taller or shorter changes nothing
 *     about the size. If the rows don't fit the height, they scroll or page;
 *     they never shrink to fit it.
 *  3. Clamped to the manifest's own min/max last, so a box too narrow to
 *     show even the widest row at `minPx` settles there and the label
 *     truncates (the label track is `1fr min-w-0 overflow-hidden`) — the one
 *     place rule 1 cannot be honoured because nothing smaller is legible.
 *
 * So: `size = clamp(boxWidth / widestRowWidthPerFontPx, minPx, maxPx)`.
 *
 * NO BINARY SEARCH, because none is needed. For rows that do not wrap —
 * which the Renderer's own `Row` enforces — rendered width scales LINEARLY
 * with font size, so one measurement at any known size gives an exact ratio
 * and the answer is arithmetic.
 *
 * DAY-TO-DAY WOBBLE IS ACCEPTED, and it is the direct cost of "the whole
 * text is always visible": a returning "Candle Lighting" row on Friday is a
 * wider row, so the type comes down a little to keep it in view, and goes
 * back up on Sunday. That is what fitting the width to the content means. The
 * Renderer re-measures when the set of labels changes (its `signature`), so
 * the fit tracks the rows actually on screen.
 */

export type FitMeasurement = {
  /** The clipping box's width, in CSS pixels. The only box dimension that
   *  matters — height plays no part in the size. */
  boxWidthPx: number;
  /**
   * The width of the WIDEST row — label, gap and time together — per 1px of
   * font size, measured at the font size that was actually applied when it
   * was read.
   *
   * The whole row, not just the time column: rule 1 keeps the full text
   * visible, so the label's width is part of what the box has to hold.
   *
   * Zero or negative means nothing measurable, and the size falls through to
   * `maxPx` rather than collapsing to zero.
   */
  rowWidthPerFontPx: number;
};

/**
 * The font size, in CSS pixels, this box should render at.
 *
 * `minPx`/`maxPx` are the manifest's own bounds, already resolved to pixels
 * by the caller. The clamp is last — see rule 3.
 */
export function fitFontSizePx(measurement: FitMeasurement, bounds: { minPx: number; maxPx: number }): number {
  const { boxWidthPx, rowWidthPerFontPx } = measurement;
  const { minPx, maxPx } = bounds;

  // Rule 1. `maxPx` when there is nothing to measure, so an empty or
  // unmeasurable table sits at its largest allowed size rather than at zero.
  const widthDriven = rowWidthPerFontPx > 0 ? boxWidthPx / rowWidthPerFontPx : maxPx;

  // Rule 3. Nothing here reads the box height — that is rule 2.
  return Math.max(minPx, Math.min(maxPx, widthDriven));
}
