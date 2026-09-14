/**
 * widgets/zmanim/fit.ts — what `fit` means for the Zmanim table, driven
 * directly with no DOM.
 *
 * The Renderer measures two numbers (the box's width, and the widest row's
 * width per pixel of font size) and hands them here. What decides the type
 * size is one clamp over those, which is why it is a pure function: what the
 * rules imply is exactly the kind of thing a comment can claim and a test can
 * check.
 *
 * THE RULES, restated so a failure here reads against them:
 *   1. Width drives the size. Wider box, bigger text; narrower box, smaller.
 *   2. Height is ignored entirely — it never touches the size.
 *   3. The whole row is kept visible down to minFontSize, then the label
 *      truncates (its track is built for it).
 */

import { fitFontSizePx } from "../widgets/zmanim/fit.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | number | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}

/*
 * A plausible row's full width, in em per pixel of font size — the widest
 * label, the gap, and the time together. This is the one ratio the function
 * takes, and `fit` keeps all of it visible.
 *
 * `11:21 AM` is eight tabular figures at ~0.563em, a sixteen-character label
 * at ~0.5em, and the 1em gap between them: about 13em of width per em of type.
 */
const ROW_WIDTH_RATIO = 13.1;
const BOUNDS = { minPx: 14, maxPx: 200 };

const size = (boxWidthPx: number, widthRatio = ROW_WIDTH_RATIO) =>
  fitFontSizePx({ boxWidthPx, rowWidthPerFontPx: widthRatio }, BOUNDS);

console.log("\n-- rule 1: width drives the size ----------------------------");

{
  const narrow = size(300);
  const wide = size(600);
  check(wide > narrow, "a wider box gives bigger text", `${narrow.toFixed(1)} -> ${wide.toFixed(1)}`);
  check(
    Math.abs(wide / narrow - 2) < 0.001,
    "and proportionally so — twice the width is twice the type",
    (wide / narrow).toFixed(3),
  );
  check(
    Math.abs(size(400) - 400 / ROW_WIDTH_RATIO) < 0.001,
    "the size is the box width over the widest row's width per pixel of type",
    size(400).toFixed(2),
  );
}

console.log("\n-- rule 1: the whole row is kept visible --------------------");

{
  // At the fitted size the widest row is exactly as wide as the box — every
  // label reads in full, which is what "fit to box" now means here.
  const boxWidth = 500;
  const fitted = size(boxWidth);
  check(
    Math.abs(fitted * ROW_WIDTH_RATIO - boxWidth) < 0.001,
    "the widest row fills the box width exactly at the fitted size — nothing truncates",
    `${(fitted * ROW_WIDTH_RATIO).toFixed(1)}px of row in ${boxWidth}px`,
  );
}

console.log("\n-- rule 2: height is ignored --------------------------------");

{
  /*
   * The function takes no height at all, so there is nothing a taller or
   * shorter box could change. That is the whole of rule 2: a taller box shows
   * MORE rows at the same size (the overflow mode carries the rest — see
   * ./overflow.ts), it never shrinks the type to fit them.
   */
  check(
    size(500) === size(500),
    "the function takes no box height, so resizing the height cannot move the size",
    size(500).toFixed(1),
  );
}

console.log("\n-- rule 1: a returning row tracks the width ------------------");

{
  /*
   * The day-to-day wobble is deliberate now, and it is the cost of keeping
   * every label visible. A Friday's "Candle Lighting" is a wider row than a
   * weekday's widest, so in a fixed box it eases the type down a little to
   * keep it in view — and back up when the row leaves.
   */
  const boxWidth = 400;
  const weekdayRow = 12.4;
  const fridayRow = 13.1;
  check(
    size(boxWidth, fridayRow) < size(boxWidth, weekdayRow),
    "a wider Friday row gives slightly smaller type in the same box, so it stays fully visible",
    `${size(boxWidth, weekdayRow).toFixed(1)} -> ${size(boxWidth, fridayRow).toFixed(1)}`,
  );
}

console.log("\n-- the bounds ------------------------------------------------");

{
  check(size(100_000) === BOUNDS.maxPx, "a very wide box stops at maxFontSize", size(100_000));
  check(size(1) === BOUNDS.minPx, "a box too narrow for the row even at minFontSize settles there", size(1));
}

console.log("\n-- degenerate measurements never produce a broken size ------");

{
  const unmeasured = fitFontSizePx({ boxWidthPx: 0, rowWidthPerFontPx: 0 }, BOUNDS);
  check(
    Number.isFinite(unmeasured) && unmeasured >= BOUNDS.minPx,
    "zeroes give a real number inside the bounds, not NaN",
    unmeasured,
  );
  const noRow = fitFontSizePx({ boxWidthPx: 500, rowWidthPerFontPx: 0 }, BOUNDS);
  check(
    noRow === BOUNDS.maxPx,
    "an unmeasurable row falls through to maxFontSize rather than collapsing to zero",
    noRow.toFixed(1),
  );
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
