/*
 * How the Zmanim table sizes itself — WIDTH-DRIVEN TYPE, VERTICAL SCROLL OR PAGE.
 *
 * The type size is set by the box's WIDTH: as large as it can be while the
 * widest row's full text still fits across the box (plan.md §5c / the original
 * brief: "the width of the text should be completely visible"). A wider box
 * means bigger type, a narrower box smaller — and the properties panel's type
 * field is a live readout of that size, with typing a size resizing the box to
 * reach it.
 *
 * The box's HEIGHT never changes the type. When the rows are taller than the
 * box, the table either PAGES through whole rows or SCROLLS continuously — the
 * widget's own choice — never shrinking the text to cram them in.
 *
 * Pure functions so the arithmetic is testable with no DOM
 * (scripts/test-zmanim-fit.ts); the Renderer measures the pixels and calls in.
 */

/** The type size, in CSS pixels, the widest row needs so its full text fits the
 *  box width — the whole of what sets the size. Clamped to the manifest bounds. */
export function zmanimFontPx(
  input: { boxWidthPx: number; widthPerFontPx: number },
  bounds: { minPx: number; maxPx: number },
): number {
  const { boxWidthPx, widthPerFontPx } = input;
  const { minPx, maxPx } = bounds;
  // Nothing measured yet (widthPerFontPx 0): sit at the ceiling until the
  // measurement lands, rather than collapse to zero.
  const widthDriven = widthPerFontPx > 0 ? boxWidthPx / widthPerFontPx : maxPx;
  return Math.max(minPx, Math.min(maxPx, widthDriven));
}

/** How many whole rows fit the available height at a given row height — at
 *  least one, and never a partial row (the point of paging). */
export function rowsPerPage(availableHeightPx: number, rowHeightPx: number): number {
  if (rowHeightPx <= 0) return 1;
  return Math.max(1, Math.floor(availableHeightPx / rowHeightPx));
}

/** How many pages `total` rows take at `perPage` rows each. */
export function pageCount(total: number, perPage: number): number {
  if (perPage <= 0) return 1;
  return Math.max(1, Math.ceil(total / perPage));
}
