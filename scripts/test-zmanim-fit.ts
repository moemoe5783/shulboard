/**
 * widgets/zmanim/fit.ts — the Zmanim table's sizing arithmetic, driven with no
 * DOM.
 *
 * THE RULES, restated so a failure here reads against them:
 *   1. WIDTH sets the type size — as large as fits the widest row across the
 *      box. Wider box, bigger type; narrower box, smaller. Height never enters.
 *   2. Vertical overflow is handled by paging (or scrolling), not shrinking:
 *      whole rows only, at least one per page.
 */

import { pageCount, rowsPerPage, zmanimFit, zmanimFontPx } from "../widgets/zmanim/fit.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | number | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}

const WIDTH_RATIO = 13.1; // px of widest-row width per px of font
const BOUNDS = { minPx: 6, maxPx: 400 };

console.log("\n-- rule 1: width sets the size -------------------------------");

{
  // The widest row fills the box width exactly at the resulting size.
  const boxWidth = 30 * WIDTH_RATIO;
  const size = zmanimFontPx({ boxWidthPx: boxWidth, widthPerFontPx: WIDTH_RATIO }, BOUNDS);
  check(Math.abs(size - 30) < 0.001, "the size makes the widest row fill the box width", size.toFixed(2));

  // Twice the width is twice the type — the panel readout and box-resize rely on
  // this linearity.
  const wide = zmanimFontPx({ boxWidthPx: boxWidth * 2, widthPerFontPx: WIDTH_RATIO }, BOUNDS);
  check(Math.abs(wide / size - 2) < 0.001, "twice the box width is twice the type", (wide / size).toFixed(3));
}

console.log("\n-- the bounds ------------------------------------------------");

{
  check(zmanimFontPx({ boxWidthPx: 100_000, widthPerFontPx: WIDTH_RATIO }, BOUNDS) === BOUNDS.maxPx,
    "a very wide box stops at maxFontSize");
  check(zmanimFontPx({ boxWidthPx: 1, widthPerFontPx: WIDTH_RATIO }, BOUNDS) === BOUNDS.minPx,
    "a box too narrow even at minFontSize settles at the floor");
  check(zmanimFontPx({ boxWidthPx: 500, widthPerFontPx: 0 }, BOUNDS) === BOUNDS.maxPx,
    "before the row is measured, it sits at the ceiling rather than collapsing to zero");
}

console.log("\n-- rule 2: vertical paging, whole rows ----------------------");

{
  // 100px of room, 24px rows -> 4 whole rows per page (not 4.16).
  check(rowsPerPage(100, 24) === 4, "as many whole rows as fit, never a partial one", rowsPerPage(100, 24));
  check(rowsPerPage(10, 24) === 1, "at least one row even when none fully fit", rowsPerPage(10, 24));
  check(rowsPerPage(100, 0) === 1, "a degenerate row height still yields one row, not a crash", rowsPerPage(100, 0));

  check(pageCount(11, 4) === 3, "eleven rows at four per page is three pages", pageCount(11, 4));
  check(pageCount(4, 4) === 1, "rows that all fit are a single page — no cycling", pageCount(4, 4));
  check(pageCount(3, 10) === 1, "fewer rows than a page is still one page", pageCount(3, 10));
}

console.log("");
console.log("\n-- every row fits, down to the readable minimum ----------------");
{
  const bounds = { minPx: 4, readablePx: 12, maxPx: 200 };
  const tall = zmanimFit({ boxWidthPx: 600, boxHeightPx: 2000, widthPerFontPx: 10, heightPerFontPx: 15 }, bounds);
  check(tall.fontPx === 60 && tall.fits, "a tall box: the width decides (600 / 10)", String(tall.fontPx));
  const short = zmanimFit({ boxWidthPx: 600, boxHeightPx: 300, widthPerFontPx: 10, heightPerFontPx: 15 }, bounds);
  check(short.fontPx === 20 && short.fits, "a short box: the height decides (300 / 15), every row fits", String(short.fontPx));
  const tiny = zmanimFit({ boxWidthPx: 600, boxHeightPx: 90, widthPerFontPx: 10, heightPerFontPx: 15 }, bounds);
  check(tiny.fontPx === 12 && !tiny.fits, "too short even at the readable minimum: held there, and it says it doesn't fit", String(tiny.fontPx));
  const narrow = zmanimFit({ boxWidthPx: 80, boxHeightPx: 90, widthPerFontPx: 10, heightPerFontPx: 15 }, bounds);
  check(narrow.fontPx === 8, "a box too narrow for the minimum still gets its width-driven size — no row cut off", String(narrow.fontPx));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
