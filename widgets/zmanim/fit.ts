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
 * widget's own choice — never shrinking the text to cram them in. The editor
 * says so on the element ("Showing 11 zmanim in 3 pages").
 *
 * UNLESS the element is set to SHRINK TO FIT (its own opt-in, zmanimFit
 * below): then the type shrinks until every row fits, down to a floor a room
 * can read, and only pages past that.
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

/**
 * "Shrink to fit" (config.overflow === "shrink", never the default): the
 * smallest the type goes to keep every row, in board design units. Chosen in
 * /fonts-lab at 1920x1080 — 32 units is about 2 cm tall on a 55" screen,
 * the least a room reads from across the floor; 20 was too small. Past it the
 * table pages after all. A box too narrow for even this still gets its
 * width-driven size — a row's text is never cut off.
 */
export const ZMANIM_SHRINK_MIN_UNITS = 32;

/**
 * The type size that shows every row: the largest the width allows and the
 * height allows, but not below the readable minimum (unless the width demands
 * it). `fits` says whether every row made it at that size.
 *
 * `heightPerFontPx` is the whole table's height (every row and the credit line)
 * per CSS pixel of type — it scales with the type, so one measurement answers
 * for every size.
 */
export function zmanimFit(
  input: { boxWidthPx: number; boxHeightPx: number; widthPerFontPx: number; heightPerFontPx: number },
  bounds: { minPx: number; readablePx: number; maxPx: number },
): { fontPx: number; fits: boolean } {
  const { boxWidthPx, boxHeightPx, widthPerFontPx, heightPerFontPx } = input;
  const byWidth = widthPerFontPx > 0 ? boxWidthPx / widthPerFontPx : bounds.maxPx;
  const byHeight = heightPerFontPx > 0 ? boxHeightPx / heightPerFontPx : bounds.maxPx;
  const floor = Math.min(bounds.readablePx, byWidth);
  const fontPx = Math.max(bounds.minPx, Math.min(bounds.maxPx, Math.max(Math.min(byWidth, byHeight), floor)));
  return { fontPx, fits: heightPerFontPx <= 0 || heightPerFontPx * fontPx <= boxHeightPx + 0.5 };
}
