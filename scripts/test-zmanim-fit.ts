/**
 * widgets/zmanim/fit.ts — what `fit` means for the Zmanim table, driven
 * directly with no DOM.
 *
 * The Renderer measures four numbers (the box's width and height, and the
 * content's width and height per pixel of font size) and hands them here. What
 * decides the type size is one closed-form min-and-clamp over those, which is
 * why it is a pure function: what the rules imply is exactly the kind of thing
 * a comment can claim and a test can check.
 *
 * THE RULES, restated so a failure here reads against them:
 *   1. FIT BOTH AXES. The size is the largest at which the whole table — every
 *      row's full text AND all the rows stacked — still fits the box. That is
 *      the smaller of the width-driven and height-driven sizes.
 *   2. Width binds in a tall box (the widest row would overflow first); height
 *      binds in a short box (the stack would overflow first). Whichever binds
 *      sets the size.
 *   3. Shrink to fit, never clip. A busier day or a smaller box renders
 *      smaller, down to minFontSize; only a box too small even at minFontSize
 *      settles there and lets the shared clip take over.
 */

import { fitFontSizePx } from "../widgets/zmanim/fit.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | number | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}

/*
 * Plausible content ratios, in px of content per px of font size.
 *
 * WIDTH: the widest row's full text — a sixteen-character label, the gap, and
 * "11:21 AM" — at about 13em of width per em of type.
 * HEIGHT: eleven rows stacked at roughly 1.25em line height each, about 14em of
 * height per em of type.
 */
const WIDTH_RATIO = 13.1;
const HEIGHT_RATIO = 14;
const BOUNDS = { minPx: 6, maxPx: 200 };

const size = (
  boxWidthPx: number,
  boxHeightPx: number,
  widthPerFontPx = WIDTH_RATIO,
  heightPerFontPx = HEIGHT_RATIO,
) => fitFontSizePx({ boxWidthPx, boxHeightPx, widthPerFontPx, heightPerFontPx }, BOUNDS);

console.log("\n-- rule 1: the size is the smaller of the two axes ----------");

{
  // A tall box: width is the binding constraint, so the size is width-driven.
  const wide = 600;
  const tall = 100_000;
  check(
    Math.abs(size(wide, tall) - wide / WIDTH_RATIO) < 0.001,
    "in a tall box the width drives the size",
    size(wide, tall).toFixed(2),
  );

  // A wide box: height is the binding constraint, so the size is height-driven.
  const shortH = 200;
  check(
    Math.abs(size(100_000, shortH) - shortH / HEIGHT_RATIO) < 0.001,
    "in a wide box the height drives the size",
    size(100_000, shortH).toFixed(2),
  );

  // With both finite, it is always the smaller of the two.
  const both = size(600, 200);
  check(
    Math.abs(both - Math.min(600 / WIDTH_RATIO, 200 / HEIGHT_RATIO)) < 0.001,
    "with both axes finite the size is the smaller of the two",
    both.toFixed(2),
  );
}

console.log("\n-- rule 2: both axes shrink the type ------------------------");

{
  const roomy = size(600, 800);
  const narrower = size(300, 800);
  const shorter = size(600, 400);
  check(narrower < roomy, "a narrower box gives smaller text", `${roomy.toFixed(1)} -> ${narrower.toFixed(1)}`);
  check(shorter < roomy, "a shorter box gives smaller text", `${roomy.toFixed(1)} -> ${shorter.toFixed(1)}`);
}

console.log("\n-- rule 3: a returning row tracks the fit -------------------");

{
  /*
   * A Friday's "Candle Lighting" is a wider row AND one more line than a
   * weekday's, so both ratios grow and the type eases down to keep the whole
   * table visible — then back up when the row leaves.
   */
  const w = 400;
  const h = 400;
  const weekday = size(w, h, 12.4, 13);
  const friday = size(w, h, 13.1, 14);
  check(friday < weekday, "a busier week gives slightly smaller type, so it all stays visible", `${weekday.toFixed(1)} -> ${friday.toFixed(1)}`);
}

console.log("\n-- the bounds ------------------------------------------------");

{
  check(size(100_000, 100_000) === BOUNDS.maxPx, "a huge box stops at maxFontSize", size(100_000, 100_000));
  check(size(1, 1) === BOUNDS.minPx, "a box too small for the table even at minFontSize settles there", size(1, 1));
}

console.log("\n-- degenerate measurements never produce a broken size ------");

{
  const unmeasured = fitFontSizePx({ boxWidthPx: 0, boxHeightPx: 0, widthPerFontPx: 0, heightPerFontPx: 0 }, BOUNDS);
  check(
    Number.isFinite(unmeasured) && unmeasured >= BOUNDS.minPx,
    "zeroes give a real number inside the bounds, not NaN",
    unmeasured,
  );
  const noContent = fitFontSizePx({ boxWidthPx: 500, boxHeightPx: 500, widthPerFontPx: 0, heightPerFontPx: 0 }, BOUNDS);
  check(
    noContent === BOUNDS.maxPx,
    "unmeasurable content falls through to maxFontSize rather than collapsing to zero",
    noContent.toFixed(1),
  );
  const onlyHeight = fitFontSizePx({ boxWidthPx: 500, boxHeightPx: 200, widthPerFontPx: 0, heightPerFontPx: HEIGHT_RATIO }, BOUNDS);
  check(
    Math.abs(onlyHeight - 200 / HEIGHT_RATIO) < 0.001,
    "with only one axis measurable, that axis alone drives the size",
    onlyHeight.toFixed(2),
  );
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
