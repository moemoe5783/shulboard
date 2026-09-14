/*
 * `fit` mode for the Zmanim table — the ONLY sizing mode this widget has.
 *
 * FIT BOTH AXES, SHRINK TO FIT, NEVER CLIP. The type is as large as it can be
 * while the whole table — every row's full text, and all the rows stacked —
 * fits the box, and it comes down as far as it must so nothing is cut off or
 * scrolled. A busier day (a returning candle-lighting row) or a smaller box
 * simply renders smaller. There is no page/scroll overflow any more: fit
 * always shows everything.
 *
 * CLOSED FORM, no binary search. Rows do not wrap (the Renderer's `Row`
 * enforces it), so both the content's width and its height scale LINEARLY with
 * font size. One measurement at a known size therefore gives the exact size at
 * which each axis is full, and the answer is the smaller of the two, clamped:
 *
 *   size = min(boxWidth / widthPerFont, boxHeight / heightPerFont)
 *
 * The width term keeps the widest row's full text visible (measured at the
 * grid's `max-content` width, so a long label is not truncated); the height
 * term keeps every row on screen at once. Whichever binds is the one that was
 * going to overflow, so taking the min is exactly "fit both axes."
 */

export type FitMeasurement = {
  /** The clipping box, in CSS pixels. */
  boxWidthPx: number;
  boxHeightPx: number;
  /**
   * The content's natural WIDTH per 1px of font size — the widest row's full
   * text (label, gap and time), measured at the grid's `max-content` width so
   * nothing is truncated. Zero means nothing measurable; the width term is
   * then skipped.
   */
  widthPerFontPx: number;
  /**
   * The content's natural HEIGHT per 1px of font size — every row stacked (plus
   * the footnote block when shown). Zero means nothing measurable; the height
   * term is skipped.
   */
  heightPerFontPx: number;
};

/**
 * The font size, in CSS pixels, this box should render at.
 *
 * `minPx`/`maxPx` are the manifest's own bounds, already resolved to pixels by
 * the caller. The clamp is last — a box too small to show the content even at
 * `minPx` settles there and the shared clip takes over (rare, and the one case
 * "never clip" cannot be honoured because nothing smaller is legible).
 */
export function fitFontSizePx(measurement: FitMeasurement, bounds: { minPx: number; maxPx: number }): number {
  const { boxWidthPx, boxHeightPx, widthPerFontPx, heightPerFontPx } = measurement;
  const { minPx, maxPx } = bounds;

  // `Infinity` when an axis has nothing to measure, so the `min` below falls
  // through to the other axis rather than collapsing to zero.
  const widthDriven = widthPerFontPx > 0 ? boxWidthPx / widthPerFontPx : Number.POSITIVE_INFINITY;
  const heightDriven = heightPerFontPx > 0 ? boxHeightPx / heightPerFontPx : Number.POSITIVE_INFINITY;

  const fit = Math.min(widthDriven, heightDriven);
  // Both axes empty (nothing measured yet): sit at max rather than at Infinity.
  if (!Number.isFinite(fit)) return maxPx;

  return Math.max(minPx, Math.min(maxPx, fit));
}
