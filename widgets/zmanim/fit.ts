/*
 * How the Zmanim table sizes itself — EVERY ROW SHOWS, OR THE EDITOR SAYS SO.
 *
 * The type is as large as it can be while the widest row's full text fits
 * across the box ("the width of the text should be completely visible") AND
 * every configured row, with the credit line, fits down it. A wider box means
 * bigger type; so does a taller one, until the width stops it. The properties
 * panel's type field is a live readout of that size.
 *
 * A ZMAN IS NEVER SILENTLY DROPPED. A theme with larger faces, a longer label,
 * a shorter box: the type shrinks to keep every row — down to a minimum a room
 * can still read (ZMANIM_MIN_READABLE_UNITS). Only below that does the table
 * page or scroll through its rows (the widget's own choice), and then the
 * element carries a warning in the editor saying how many don't fit
 * (Renderer.tsx, `data-editor-hint`), so nobody publishes a board that hides
 * zmanim without having been told.
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

/** The smallest the type goes to keep every row, in board design units: below
 *  this a lobby can't read it, and the table pages instead (with a warning in
 *  the editor). A box too narrow for even this still gets its width-driven size
 *  — a row's text is never cut off. */
export const ZMANIM_MIN_READABLE_UNITS = 20;

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
