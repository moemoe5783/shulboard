/**
 * widgets/zmanim/fit.ts — the Zmanim table's sizing arithmetic, driven with no
 * DOM.
 *
 * THE RULES, restated so a failure here reads against them:
 *   1. The type renders at the CONFIGURED size. Height never shrinks it.
 *   2. WIDTH can only shrink it — enough that the widest row fits — never grow
 *      it above the configured size.
 *   3. Vertical overflow is PAGING: whole rows only, at least one per page.
 */

import { pageCount, rowsPerPage, zmanimFontPx } from "../widgets/zmanim/fit.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | number | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}

const WIDTH_RATIO = 13.1; // px of widest-row width per px of font
const BOUNDS = { minPx: 6, maxPx: 400 };

console.log("\n-- rule 1: the type renders at the configured size ----------");

{
  // A box wide enough for the row at the configured size renders AT that size —
  // not larger, however wide the box.
  const size = zmanimFontPx({ configPx: 32, boxWidthPx: 100_000, widthPerFontPx: WIDTH_RATIO }, BOUNDS);
  check(size === 32, "a roomy box renders at exactly the configured size, never larger", size);
}

console.log("\n-- rule 2: width shrinks it, and only width -----------------");

{
  // config 60, but a box only wide enough for ~30 at this row width -> shrinks.
  const boxWidth = 30 * WIDTH_RATIO;
  const size = zmanimFontPx({ configPx: 60, boxWidthPx: boxWidth, widthPerFontPx: WIDTH_RATIO }, BOUNDS);
  check(Math.abs(size - 30) < 0.001, "a too-narrow box shrinks the type so the widest row fits", size.toFixed(2));
  check(size < 60, "and only downward — never above the configured size", `${size.toFixed(1)} < 60`);

  // The widest row exactly fills the box width at the fitted size.
  check(Math.abs(size * WIDTH_RATIO - boxWidth) < 0.001, "the widest row fills the width exactly at the fitted size");
}

{
  // No width measured yet (0) -> the configured size stands.
  const size = zmanimFontPx({ configPx: 40, boxWidthPx: 500, widthPerFontPx: 0 }, BOUNDS);
  check(size === 40, "before the row is measured, the configured size stands unshrunk", size);
}

console.log("\n-- the bounds ------------------------------------------------");

{
  check(zmanimFontPx({ configPx: 999, boxWidthPx: 100_000, widthPerFontPx: WIDTH_RATIO }, BOUNDS) === BOUNDS.maxPx,
    "a configured size past the ceiling clamps to maxFontSize");
  check(zmanimFontPx({ configPx: 40, boxWidthPx: 1, widthPerFontPx: WIDTH_RATIO }, BOUNDS) === BOUNDS.minPx,
    "a box too narrow even at minFontSize settles at the floor");
}

console.log("\n-- rule 3: vertical paging, whole rows ----------------------");

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
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
