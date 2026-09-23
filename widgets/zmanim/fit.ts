/*
 * How the Zmanim table sizes itself — WIDTH-CAPPED TYPE, VERTICAL PAGING.
 *
 * The rules, after a lot of back-and-forth, are now:
 *
 *  1. The type renders at the CONFIGURED size (config.size), full stop — the
 *     height of the box never shrinks it. A shorter box, or more zmanim rows,
 *     does NOT make the text smaller. That was the recurring complaint: a box
 *     resize or an added row must not rescale the type.
 *  2. WIDTH is the one thing that can shrink it: if the widest row would not
 *     fit the box's width at the configured size, the type comes down just
 *     enough that the whole row is visible (plan.md §5c / the original brief:
 *     "the width of the text should be completely visible"). It never grows
 *     above the configured size.
 *  3. VERTICAL overflow is handled by PAGING, not shrinking: as many WHOLE rows
 *     as fit the height form a page, and the widget cycles through the pages.
 *     "Only display what it could fully at a time."
 *
 * These are pure functions so the arithmetic is testable with no DOM
 * (scripts/test-zmanim-fit.ts); the Renderer measures the pixels and calls in.
 */

/** The type size, in CSS pixels, the table should render at — the configured
 *  size, brought down only if the widest row would overflow the width. */
export function zmanimFontPx(
  input: { configPx: number; boxWidthPx: number; widthPerFontPx: number },
  bounds: { minPx: number; maxPx: number },
): number {
  const { configPx, boxWidthPx, widthPerFontPx } = input;
  const { minPx, maxPx } = bounds;

  // The largest size at which the widest row still fits the box width. Infinity
  // when nothing has been measured yet (widthPerFontPx 0), so the config size
  // stands unshrunk.
  const widthDriven = widthPerFontPx > 0 ? boxWidthPx / widthPerFontPx : Number.POSITIVE_INFINITY;

  // Never above the configured size (width only shrinks, never grows), then
  // clamped to the manifest's own floor/ceiling.
  const capped = Math.min(configPx, widthDriven);
  return Math.max(minPx, Math.min(maxPx, capped));
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
