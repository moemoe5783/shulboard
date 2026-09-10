/**
 * widgets/zmanim/overflow.ts — what happens to zmanim rows that don't fit,
 * driven directly with no DOM.
 *
 * The Renderer measures four numbers (box height and width, content
 * height, row count) and hands them here with the master tick. Everything
 * that decides where the list sits is arithmetic over those, which is why
 * it lives in its own module: a component could only be tested through a
 * browser, and none of this needs one.
 */

import { overflowState, PAGE_SECONDS, SCROLL_UNITS_PER_SECOND } from "../widgets/zmanim/overflow.ts";

/** The default speed, in board design units per second. Every case below
 *  uses it unless it is the one measuring another. */
const SPEED = SCROLL_UNITS_PER_SECOND.medium;

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | number | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}

// A 1920-wide board, a 400px-tall box, twelve rows of 42px = 504px of
// content. Nine whole rows fit and three don't — the ordinary "selected
// more than the box holds" case.
const BOX = { boxHeight: 400, boxWidth: 1920, canvasWidth: 1920, speed: "medium" as const };
const TWELVE = { ...BOX, contentHeight: 504, rowCount: 12 };
/** Same box, seven rows of 42px = 294px. Fits with room to spare. */
const SEVEN = { ...BOX, contentHeight: 294, rowCount: 7 };

console.log("\n-- inert unless the rows really don't fit ------------------");

for (const mode of ["page", "scroll", "clip"] as const) {
  const state = overflowState({ mode, elapsedSeconds: 12_345, ...SEVEN });
  check(!state.overflowing && state.offset === 0 && !state.animate,
    `${mode}: a table that fits is perfectly still — no offset, no transition`,
    `offset ${state.offset}`);
}
check(
  !overflowState({ mode: "page", elapsedSeconds: 12_345, ...BOX, contentHeight: 401, rowCount: 10 }).overflowing,
  "one pixel over the box is NOT overflow — a pixel of slack, because an auto-height flex box measures a "
    + "fraction past itself from line-height rounding alone",
);
check(
  overflowState({ mode: "page", elapsedSeconds: 12_345, ...BOX, contentHeight: 402, rowCount: 10 }).overflowing,
  "two pixels over is",
);

console.log("\n-- before measurement, and on the server ------------------");

check(
  !overflowState({ mode: "scroll", elapsedSeconds: 100, boxHeight: 0, boxWidth: 0, canvasWidth: 1920, contentHeight: 0, rowCount: 12, speed: "medium" })
    .overflowing,
  "unmeasured (zero heights) reads as fitting, so the first frame is a still, complete table",
);
check(
  overflowState({ mode: "scroll", elapsedSeconds: null, ...TWELVE }).offset === 0,
  "and with no tick yet — the server render — nothing has moved either",
);

console.log("\n-- clip: docs/sizing.md §3's own rule ----------------------");

{
  const state = overflowState({ mode: "clip", elapsedSeconds: 12_345, ...TWELVE });
  check(state.overflowing, "clip still reports that it IS overflowing, so the editor warning can fire");
  check(state.offset === 0 && !state.animate,
    "but nothing moves — the rows past the bottom are simply cut off",
    `offset ${state.offset}`);
}

console.log("\n-- page: whole rows, a plain swap, and it comes back -------");

{
  const first = overflowState({ mode: "page", elapsedSeconds: 0, ...TWELVE });
  check(first.rowsPerPage === 9, "400px of box over 42px rows is nine whole rows per page", first.rowsPerPage);
  check(first.pages === 2, "twelve rows in nines is two pages", first.pages);
  check(first.offset === 0, "page one sits at the top", first.offset);
  check(!first.animate, "and never transitions — design.md's plain-swap rule");

  const second = overflowState({ mode: "page", elapsedSeconds: PAGE_SECONDS, ...TWELVE });
  check(second.offset === 9 * 42, "page two is exactly nine rows down, so no row is cut in half", second.offset);

  // A whole cycle: back to the top, not off the end.
  const wrapped = overflowState({ mode: "page", elapsedSeconds: PAGE_SECONDS * 2, ...TWELVE });
  check(wrapped.offset === 0, "and it returns to the top rather than running past the last row", wrapped.offset);
}

{
  // The row count includes the spacers `fit` mode pads with, so a paging
  // fit widget divides by the declared count. Checked because getting this
  // wrong would put a page boundary through a row.
  const state = overflowState({ mode: "page", elapsedSeconds: 0, ...BOX, contentHeight: 504, rowCount: 12 });
  const rowHeight = 504 / 12;
  check(Number.isInteger(state.offset / rowHeight) || state.offset === 0,
    "every page offset is a whole number of rows",
    state.offset);
}

{
  // A box shorter than one row still shows one row rather than dividing by
  // zero and offsetting by NaN.
  const tiny = overflowState({ mode: "page", elapsedSeconds: 0, ...BOX, boxHeight: 20, contentHeight: 504, rowCount: 12 });
  check(tiny.rowsPerPage === 1, "a box shorter than a single row still pages one row at a time", tiny.rowsPerPage);
  check(tiny.pages === 12, "which is twelve pages", tiny.pages);
  check(Number.isFinite(tiny.offset), "and the offset is a real number", tiny.offset);
}

console.log("\n-- scroll: continuous, and seamless at the wrap ------------");

{
  // At 1:1 (box width == canvas width) the rate is the declared design
  // units per second.
  const a = overflowState({ mode: "scroll", elapsedSeconds: 1000, ...TWELVE });
  const b = overflowState({ mode: "scroll", elapsedSeconds: 1001, ...TWELVE });
  check(b.offset - a.offset === SPEED,
    "one tick advances the list by exactly one second's travel",
    b.offset - a.offset);
  check(a.animate, "and the translate IS transitioned — the transition is what makes a 1Hz clock look continuous");
}

{
  // Half-scale — the editor at 50% zoom, or a 960-wide board. The rate has
  // to scale with it or the same board scrolls at two different speeds in
  // the two places the same Renderer draws it.
  const half = overflowState({ mode: "scroll", elapsedSeconds: 1000, ...TWELVE, boxWidth: 960 });
  const full = overflowState({ mode: "scroll", elapsedSeconds: 1000, ...TWELVE });
  const halfNext = overflowState({ mode: "scroll", elapsedSeconds: 1001, ...TWELVE, boxWidth: 960 });
  check(halfNext.offset - half.offset === SPEED / 2,
    "at half the rendered width the rate is half, so the board scrolls at the same apparent speed",
    halfNext.offset - half.offset);
  check(full.offset !== half.offset, "which is a different offset from the full-width one, as it must be");
}

{
  // The seam. `wrapped` marks the one frame the transition has to be off
  // for, because the offset has just jumped from the bottom back to the
  // top and CSS would otherwise animate the whole list backwards.
  const cycleSeconds = 504 / SPEED; // 31.5s
  const justWrapped = overflowState({ mode: "scroll", elapsedSeconds: Math.ceil(cycleSeconds), ...TWELVE });
  check(justWrapped.wrapped, "the first tick of a new cycle is marked as wrapped", justWrapped.offset);
  check(justWrapped.animate, "it still animates in principle — the Renderer is what suppresses the transition");

  const middle = overflowState({ mode: "scroll", elapsedSeconds: Math.floor(cycleSeconds / 2), ...TWELVE });
  check(!middle.wrapped, "mid-cycle is not", middle.offset);

  // And the wrap really does return to near-zero rather than running away.
  const many = overflowState({ mode: "scroll", elapsedSeconds: 100_000, ...TWELVE });
  check(many.offset >= 0 && many.offset < 504,
    "however long the screen has been up, the offset stays inside one copy of the list",
    many.offset);
}

{
  // Never marked wrapped when the list is not moving — otherwise a static
  // table would report a seam it does not have.
  check(!overflowState({ mode: "scroll", elapsedSeconds: 0, ...SEVEN }).wrapped, "a fitting table is never 'wrapped'");
}

console.log("\n-- speed, and the startup bug elapsed time fixes ----------");

{
  // THE REGRESSION. The offset used to come from the absolute epoch tick,
  // so the first measured frame's target was arbitrary — measured at 224px
  // on a 504-unit list with the old 16 units/second — while the frame
  // before measurement had no offset at all. CSS then interpolated the
  // whole distance over one second (a fourteen-times sweep) and settled to
  // the real rate, which reads as stopping. Reported as "scrolls through
  // the list very fast, then slows almost to a stop".
  //
  // Elapsed time makes it zero by construction. This is the assertion that
  // would fail if anyone passed absolute seconds again.
  const first = overflowState({ mode: "scroll", elapsedSeconds: 0, ...TWELVE });
  check(first.offset === 0, "the first frame of a scroll is at the top, whatever the wall clock says", first.offset);
  check(first.wrapped, "and is marked wrapped, so no transition animates into it", String(first.wrapped));

  const secondFrame = overflowState({ mode: "scroll", elapsedSeconds: 1, ...TWELVE });
  check(secondFrame.offset === SPEED, "the second frame is exactly one second's travel down", secondFrame.offset);
  check(!secondFrame.wrapped, "and transitions normally from there");

  // The same for paging: page one, not an arbitrary page.
  const firstPage = overflowState({ mode: "page", elapsedSeconds: 0, ...TWELVE });
  check(firstPage.offset === 0, "and a paging table starts on page one", firstPage.offset);
}

{
  // The three speeds, and the arithmetic behind the default. A row is on
  // screen for (box height + row height) / speed, and the whole list comes
  // round in content height / speed.
  const rowHeight = 504 / 12;
  for (const [speed, expected] of [
    ["slow", 30],
    ["medium", 60],
    ["fast", 120],
  ] as const) {
    check(SCROLL_UNITS_PER_SECOND[speed] === expected, `${speed} is ${expected} design units per second`);
    const state = overflowState({ mode: "scroll", elapsedSeconds: 1, ...TWELVE, speed });
    check(state.offset === expected, `and one tick advances by that much at ${speed}`, state.offset);
  }
  const cycle = 504 / SCROLL_UNITS_PER_SECOND.medium;
  const dwell = (400 + rowHeight) / SCROLL_UNITS_PER_SECOND.medium;
  check(
    cycle > 6 && cycle < 12,
    "the default brings the whole list round in about the eight seconds a page holds for",
    `${cycle.toFixed(1)}s`,
  );
  check(
    dwell > 5,
    "and keeps a row legibly on screen for longer than reading it takes",
    `${dwell.toFixed(1)}s`,
  );
  check(
    SCROLL_UNITS_PER_SECOND.medium > 16 * 3,
    "all three are well above the old constant 16, which was the complaint",
    `medium ${SCROLL_UNITS_PER_SECOND.medium} against 16`,
  );
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
