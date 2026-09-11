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
 *   3. The TIME column is never clipped horizontally — too narrow means
 *      smaller type. Labels truncate instead; their track is built for it.
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
 * A plausible row, in ratios per pixel of font size — which is what the
 * function takes. `leading-snug` makes a row about 1.375 times its font
 * size tall.
 *
 * THE TWO WIDTH RATIOS ARE THE WHOLE OF ITEM 1, so they are both here
 * rather than one: the protected width is the time column plus its gap,
 * and the band between it and the whole row's width is the range of box
 * widths that used to shrink the type for nothing.
 */
const ROW_HEIGHT_RATIO = 1.375;
/** `11:21 AM` is eight tabular figures at roughly 0.563em
 *  (scripts/test-font-parity.mjs measured the face), plus the 1em gap
 *  separating it from the label. This is what rule 3 protects. */
const TIME_WIDTH_RATIO = 5.1;
/** The same row including a sixteen-character label at ~0.5em. This is
 *  what the width term was measured as until item 1, and it is 2.5× the
 *  width the row actually cannot give up. */
const WHOLE_ROW_WIDTH_RATIO = 13.1;
const BOUNDS = { minPx: 14, maxPx: 200 };

const size = (boxHeightPx: number, boxWidthPx: number, widthRatio = TIME_WIDTH_RATIO) =>
  fitFontSizePx(
    {
      boxHeightPx,
      boxWidthPx,
      protectedWidthPerFontPx: widthRatio,
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
  const needed = heightBound * TIME_WIDTH_RATIO;
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

console.log("\n-- rule 3: the TIME column is what must not clip ------------");

{
  const heightBound = size(400, 100_000);
  const needed = heightBound * TIME_WIDTH_RATIO;

  const half = size(400, needed / 2);
  check(half < heightBound, "a box half as wide as the time column needs gives smaller type",
    `${heightBound.toFixed(1)} -> ${half.toFixed(1)}`);
  check(
    Math.abs(half * TIME_WIDTH_RATIO - needed / 2) < 0.001,
    "and exactly small enough that the time fits the width — not a guess, and not clipped",
    `${(half * TIME_WIDTH_RATIO).toFixed(1)}px of time in ${(needed / 2).toFixed(1)}px`,
  );
  check(
    Math.abs(size(400, needed) - heightBound) < 0.001,
    "right down to the width the time column actually needs, and no sooner",
    `${size(400, needed).toFixed(1)} at ${needed.toFixed(1)}px`,
  );
}

console.log("\n-- ITEM 1: narrowing a roomy box must change nothing --------");

/*
 * THE REPORTED BUG, and the band it lived in. "Narrowing the box makes the
 * font smaller" — and it did, over every width between the row's ideal and
 * the time column's requirement, because the width term was measured as
 * the grid's whole `max-content` width. A 700-tall box wants 63.6px type;
 * the time column needs 325px of width for that, the whole untruncated row
 * wants 833px. Every box width in between shrank the type and not one of
 * them would have clipped a time.
 */
{
  const heightBound = size(700, 100_000);
  const timeNeeds = heightBound * TIME_WIDTH_RATIO;
  const rowWants = heightBound * WHOLE_ROW_WIDTH_RATIO;

  for (const boxWidth of [rowWants, 800, 650, 500, Math.ceil(timeNeeds)]) {
    check(
      Math.abs(size(700, boxWidth) - heightBound) < 0.001,
      `a ${Math.round(boxWidth)}px-wide box still gives the full height-driven size`,
      `${size(700, boxWidth).toFixed(1)} against ${heightBound.toFixed(1)}`,
    );
  }

  // And the same widths under the OLD measurement, so the fix is a
  // difference this file can see rather than a claim in a comment.
  check(
    size(700, 500, WHOLE_ROW_WIDTH_RATIO) < heightBound * 0.7,
    "whereas measuring the whole row's width shrank a 500px box by more than a third — the bug",
    `${size(700, 500, WHOLE_ROW_WIDTH_RATIO).toFixed(1)} against ${heightBound.toFixed(1)}`,
  );

  // One pixel below what the time column needs, it does come down — rule 3
  // is still in force, it just starts where the clipping would.
  check(
    size(700, timeNeeds * 0.8) < heightBound * 0.85,
    "below that width it does shrink, because the time itself would be cut",
    `${size(700, timeNeeds * 0.8).toFixed(1)} at ${(timeNeeds * 0.8).toFixed(0)}px`,
  );
}

{
  /*
   * THE DAY-TO-DAY WOBBLE IS GONE TOO, and that is a consequence of the
   * same change rather than a second fix. A Friday's "Candle Lighting" is a
   * longer label than most, and the old width term was measured from the
   * widest label present, so a width-bound table got smaller type that
   * day. The time column is the same width on every date — all thirteen
   * values are `H:MM AM/PM` in one tabular face — so nothing about a
   * returning row can move the size now.
   */
  const narrow = 300;
  // A weekday's widest label against a Friday's, as whole-row ratios. Under
  // the old measurement these were two different sizes in a narrow box;
  // under the new one neither reaches the function, because the only width
  // it takes is the time column's — which is identical on both days.
  const weekdayRow = 12.4;
  const fridayRow = 13.1;
  check(
    size(400, narrow, weekdayRow) !== size(400, narrow, fridayRow),
    "measuring the whole row, a Friday label and a weekday label give different sizes in a narrow box",
    `${size(400, narrow, weekdayRow).toFixed(1)} vs ${size(400, narrow, fridayRow).toFixed(1)}`,
  );
  check(
    size(400, narrow) > size(400, narrow, weekdayRow) && size(400, narrow) > size(400, narrow, fridayRow),
    "and the time column — which both days share — is wider than either, so the size holds across the week",
    `${size(400, narrow).toFixed(1)} against ${size(400, narrow, fridayRow).toFixed(1)}`,
  );
}

console.log("\n-- the bounds, and the one case rule 3 cannot honour --------");

{
  check(size(100_000, 100_000) === BOUNDS.maxPx, "a huge box stops at maxFontSize", size(100_000, 100_000));
  check(size(1, 100_000) === BOUNDS.minPx, "a tiny box stops at minFontSize", size(1, 100_000));
  check(
    size(400, 1) === BOUNDS.minPx,
    "a box too narrow for a time even at minFontSize settles there and clips — sizing.md §3's overflow case, " +
      "and the only place rule 3 gives way",
    size(400, 1),
  );
}

console.log("\n-- degenerate measurements never produce a broken size ------");

{
  // Before the first measurement, and for a box with nothing in it.
  const unmeasured = fitFontSizePx(
    { boxHeightPx: 0, boxWidthPx: 0, protectedWidthPerFontPx: 0, rowHeightPerFontPx: 0 },
    BOUNDS,
  );
  check(Number.isFinite(unmeasured) && unmeasured >= BOUNDS.minPx,
    "zeroes everywhere give a real number inside the bounds, not NaN", unmeasured);
  const noWidth = fitFontSizePx(
    { boxHeightPx: 400, boxWidthPx: 500, protectedWidthPerFontPx: 0, rowHeightPerFontPx: ROW_HEIGHT_RATIO },
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
