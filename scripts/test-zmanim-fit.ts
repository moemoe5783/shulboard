/**
 * widgets/zmanim/fit.ts — what `fit` means for the Zmanim table, driven
 * directly with no DOM.
 *
 * The Renderer measures four numbers (box height and width, and the
 * widest row's width and one row's height per pixel of font size) and
 * hands them here. Everything that decides the type size is arithmetic
 * over those, which is why it is a pure function: what the four rules
 * actually imply is exactly the kind of thing a comment can claim and a
 * test can check.
 *
 * THE RULES, restated so a failure here reads against them:
 *   1. Vertical resize drives the size. Taller box, bigger text.
 *   2. Horizontal resize does not, on its own.
 *   3. Text is never clipped horizontally — too narrow means smaller type.
 *   4. Vertical overflow is acceptable; grow into height even when the
 *      list then has to scroll or page.
 */

import { FIT_VISIBLE_ROWS, fitFontSizePx } from "../widgets/zmanim/fit.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | number | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}

/*
 * A plausible row: `leading-snug` makes a row about 1.375 times its font
 * size tall, and a label-plus-time row is roughly 9 times its font size
 * wide. Both are ratios per pixel of font size, which is what the function
 * takes — and both were chosen to make the two constraints comparable so
 * the tests can put them against each other.
 */
const ROW_HEIGHT_RATIO = 1.375;
const ROW_WIDTH_RATIO = 9;
const BOUNDS = { minPx: 14, maxPx: 200 };

const size = (boxHeightPx: number, boxWidthPx: number, widthRatio = ROW_WIDTH_RATIO) =>
  fitFontSizePx(
    {
      boxHeightPx,
      boxWidthPx,
      widthPerFontPx: widthRatio,
      rowHeightPerFontPx: ROW_HEIGHT_RATIO,
    },
    BOUNDS,
  );

console.log("\n-- rule 1: vertical resize drives the size ------------------");

{
  // Wide enough that width never binds, so height is the only constraint.
  const WIDE = 100_000;
  const short = size(200, WIDE);
  const tall = size(400, WIDE);
  check(tall > short, "a taller box gives bigger text", `${short.toFixed(1)} -> ${tall.toFixed(1)}`);
  check(
    Math.abs(tall / short - 2) < 0.001,
    "and proportionally so — twice the height is twice the type",
    (tall / short).toFixed(3),
  );
  check(
    Math.abs(short - 200 / (FIT_VISIBLE_ROWS * ROW_HEIGHT_RATIO)) < 0.001,
    `the height term is the box over ${FIT_VISIBLE_ROWS} rows' worth of line height`,
    short.toFixed(2),
  );
}

console.log("\n-- rule 4: the row count is not in it -----------------------");

{
  /*
   * THE WHOLE REASON THE SPACER ROWS COULD GO. The old fit measured total
   * content height, so the size moved when a date-conditional row
   * appeared, and spacers padded the list to the declared count to stop
   * it. `fitFontSizePx` takes a PER-ROW height and no count at all, so
   * there is nothing a count could change — which is what rule 4 asks for
   * and what makes vertical overflow a deliberate outcome rather than a
   * failure.
   */
  const WIDE = 100_000;
  check(
    size(400, WIDE) === size(400, WIDE),
    "the function takes no row count, so a returning row cannot move the size",
  );
  // And the consequence, stated as arithmetic: at this size a twelve-row
  // list is taller than the box it was sized for, which is exactly the
  // overflow the scroll and page modes exist to carry.
  const fitted = size(400, WIDE);
  const twelveRows = 12 * fitted * ROW_HEIGHT_RATIO;
  check(
    twelveRows > 400,
    `twelve rows at that size overflow a 400px box — rule 4's "grow anyway", carried by ./overflow.ts`,
    `${twelveRows.toFixed(0)}px of rows in 400px`,
  );
  const eightRows = FIT_VISIBLE_ROWS * fitted * ROW_HEIGHT_RATIO;
  check(
    Math.abs(eightRows - 400) < 1,
    `while ${FIT_VISIBLE_ROWS} rows fill it exactly, which is what the constant means`,
    `${eightRows.toFixed(1)}px`,
  );
  const fiveRows = 5 * fitted * ROW_HEIGHT_RATIO;
  check(
    fiveRows < 400,
    "and five rows leave space at the bottom rather than growing to fill it",
    `${fiveRows.toFixed(0)}px in 400px`,
  );
}

console.log("\n-- rule 2: horizontal resize alone changes nothing ----------");

{
  // A box already wide enough. Widening it further must not touch the size
  // — the height term caps it.
  const heightBound = size(400, 100_000);
  const needed = heightBound * ROW_WIDTH_RATIO;
  check(
    size(400, needed * 2) === heightBound && size(400, needed * 10) === heightBound,
    "widening a box that already had room leaves the size untouched",
    `${heightBound.toFixed(1)} at both`,
  );
  check(
    Math.abs(size(400, Math.ceil(needed)) - heightBound) < 0.5,
    "right down to the width the text actually needs",
    size(400, Math.ceil(needed)).toFixed(1),
  );
}

console.log("\n-- rule 3: too narrow shrinks the type, never clips ---------");

{
  const heightBound = size(400, 100_000);
  const needed = heightBound * ROW_WIDTH_RATIO;

  const half = size(400, needed / 2);
  check(half < heightBound, "a box half as wide as the text needs gives smaller type",
    `${heightBound.toFixed(1)} -> ${half.toFixed(1)}`);
  check(
    Math.abs(half * ROW_WIDTH_RATIO - needed / 2) < 0.001,
    "and exactly small enough that the row fits the width — not a guess, and not clipped",
    `${(half * ROW_WIDTH_RATIO).toFixed(1)}px of text in ${(needed / 2).toFixed(1)}px`,
  );
  check(
    size(400, needed / 2, ROW_WIDTH_RATIO) < size(400, needed / 2, ROW_WIDTH_RATIO / 2),
    "a longer label binds harder than a short one at the same box width",
  );
}

{
  /*
   * The residual day-to-day change, asserted rather than left in a
   * comment. On a Friday "Candle Lighting" is on the board and is a longer
   * label than most, so a WIDTH-CONSTRAINED table gets slightly smaller
   * type that day. That is rule 3 doing its job — the alternative is
   * clipping — and it happens only when width binds.
   */
  const weekdayWidth = 9;
  const fridayWidth = 11;
  const narrow = 300;
  const wide = 100_000;
  check(
    size(400, narrow, fridayWidth) < size(400, narrow, weekdayWidth),
    "a longer Friday label shrinks a width-bound table",
    `${size(400, narrow, weekdayWidth).toFixed(1)} -> ${size(400, narrow, fridayWidth).toFixed(1)}`,
  );
  check(
    size(400, wide, fridayWidth) === size(400, wide, weekdayWidth),
    "and changes nothing at all when width does not bind — which is the common case",
    size(400, wide, fridayWidth).toFixed(1),
  );
}

console.log("\n-- the bounds, and the one case rule 3 cannot honour --------");

{
  check(size(100_000, 100_000) === BOUNDS.maxPx, "a huge box stops at maxFontSize", size(100_000, 100_000));
  check(size(1, 100_000) === BOUNDS.minPx, "a tiny box stops at minFontSize", size(1, 100_000));
  check(
    size(400, 1) === BOUNDS.minPx,
    "a box too narrow for a row even at minFontSize settles there and clips — sizing.md §3's overflow case, " +
      "and the only place rule 3 gives way",
    size(400, 1),
  );
}

console.log("\n-- degenerate measurements never produce a broken size ------");

{
  // Before the first measurement, and for a box with nothing in it.
  const unmeasured = fitFontSizePx(
    { boxHeightPx: 0, boxWidthPx: 0, widthPerFontPx: 0, rowHeightPerFontPx: 0 },
    BOUNDS,
  );
  check(Number.isFinite(unmeasured) && unmeasured >= BOUNDS.minPx,
    "zeroes everywhere give a real number inside the bounds, not NaN", unmeasured);
  const noWidth = fitFontSizePx(
    { boxHeightPx: 400, boxWidthPx: 500, widthPerFontPx: 0, rowHeightPerFontPx: ROW_HEIGHT_RATIO },
    BOUNDS,
  );
  check(
    Math.abs(noWidth - size(400, 100_000)) < 0.001,
    "an unmeasurable width falls through to the height-driven size rather than collapsing to zero",
    noWidth.toFixed(1),
  );
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
