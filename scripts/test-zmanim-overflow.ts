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
  !overflowState({
    mode: "scroll",
    elapsedSeconds: null,
    boxHeight: 0,
    boxWidth: 0,
    canvasWidth: 1920,
    contentHeight: 0,
    rowCount: 12,
    speed: "medium",
  }).animate,
  "and declares no cycle either, so the server render emits no animation",
);
check(
  overflowState({ mode: "page", elapsedSeconds: null, ...TWELVE }).offset === 0,
  "a paging table with no tick yet — the server render — has not moved either",
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

console.log("\n-- scroll: one cycle, declared to CSS rather than stepped ---");

/*
 * THE SEAM, AND WHY THERE IS NOTHING PER-TICK LEFT TO TEST.
 *
 * Scroll used to return `offset = (elapsed × rate) % contentHeight` with a
 * one-second CSS transition, and a `wrapped` flag that suppressed the
 * transition on the frame the modulo reset. It was reported from a live
 * board as "runs through the list, stops, then restarts", and it could not
 * have been anything else: the transition lags a second, so at the wrap the
 * element sits at `contentHeight − rate` while the tick hands it `≈ rate`
 * with no transition — an instant skip forward, then a full second standing
 * still. One value per second can be the wrap or the next second's motion,
 * never both.
 *
 * So the contract changed shape: this now returns how long ONE CYCLE takes,
 * the Renderer hands that to a CSS animation over the two-copy stack, and
 * `translateY(-50%)` closes the loop exactly. These assertions are about
 * the duration and about the offset staying out of it.
 */
{
  // At 1:1 (box width == canvas width) the rate is the declared design
  // units per second, so a 504px list at 60/s comes round in 8.4s.
  const state = overflowState({ mode: "scroll", elapsedSeconds: 1000, ...TWELVE });
  check(
    Math.abs(state.scrollSeconds - 504 / SPEED) < 1e-9,
    "one cycle is the list's own height over the rate",
    `${state.scrollSeconds.toFixed(2)}s`,
  );
  check(state.animate, "and it animates — CSS runs the cycle, nothing here steps it");
  check(state.offset === 0, "the offset stays at zero: scrolling is not a per-tick translate any more", state.offset);
}

{
  // The tick is page's alone now. A scroll must look identical at every
  // elapsed time, including none at all — which is what makes the startup
  // bug below structurally impossible rather than merely fixed.
  const at = (elapsedSeconds: number | null) =>
    overflowState({ mode: "scroll", elapsedSeconds, ...TWELVE });
  const reference = at(0);
  for (const elapsed of [null, 0, 1, 7, 31, 100_000] as const) {
    const state = at(elapsed);
    check(
      state.offset === reference.offset && state.scrollSeconds === reference.scrollSeconds && state.animate,
      `a scroll at elapsed ${String(elapsed)} is identical to one at zero — no clock reaches it`,
      state.offset,
    );
  }
}

{
  // Half-scale — the editor at 50% zoom, or a 960-wide board. The rate has
  // to scale with it or the same board scrolls at two different speeds in
  // the two places the same Renderer draws it. With a duration rather than
  // a step, "half the rate" reads as "twice as long per cycle".
  const half = overflowState({ mode: "scroll", elapsedSeconds: 1000, ...TWELVE, boxWidth: 960 });
  const full = overflowState({ mode: "scroll", elapsedSeconds: 1000, ...TWELVE });
  check(
    Math.abs(half.scrollSeconds - full.scrollSeconds * 2) < 1e-9,
    "at half the rendered width one cycle takes twice as long, so the board scrolls at the same apparent speed",
    `${full.scrollSeconds.toFixed(2)}s -> ${half.scrollSeconds.toFixed(2)}s`,
  );
}

{
  // A longer list at the same rate takes proportionally longer, which is
  // the property that makes `-50%` correct for any content height: the
  // animation always covers exactly one copy.
  const twelve = overflowState({ mode: "scroll", elapsedSeconds: 0, ...TWELVE });
  const twice = overflowState({ mode: "scroll", elapsedSeconds: 0, ...TWELVE, contentHeight: 1008, rowCount: 24 });
  check(
    Math.abs(twice.scrollSeconds - twelve.scrollSeconds * 2) < 1e-9,
    "twice the list, twice the cycle — the rate is what stays fixed",
    `${twelve.scrollSeconds.toFixed(2)}s -> ${twice.scrollSeconds.toFixed(2)}s`,
  );
}

{
  // A table that fits declares no cycle at all, so the Renderer emits no
  // animation and there is no duplicate copy in the DOM to confuse a
  // measurement.
  const still = overflowState({ mode: "scroll", elapsedSeconds: 0, ...SEVEN });
  check(!still.animate && still.scrollSeconds === 0, "a fitting table has no cycle and does not animate");
  for (const mode of ["page", "clip"] as const) {
    check(
      overflowState({ mode, elapsedSeconds: 0, ...TWELVE }).scrollSeconds === 0,
      `${mode} never declares a scroll cycle`,
    );
  }
}

{
  /*
   * A SPEED THAT ISN'T ONE OF THE THREE, which is a real case and not a
   * defensive flourish: lib/board-doc.ts stores a widget's config as an
   * opaque record, so the manifest's default only applies to config written
   * through it. A Zmanim widget saved before `scrollSpeed` existed reaches
   * the Renderer with it undefined, and indexing the rate table with that
   * used to produce NaN — which CSS discards, stopping the list dead with
   * nothing on screen and nothing in a log to say why.
   */
  const missing = overflowState({
    mode: "scroll",
    elapsedSeconds: 0,
    ...TWELVE,
    speed: undefined as unknown as "medium",
  });
  const medium = overflowState({ mode: "scroll", elapsedSeconds: 0, ...TWELVE });
  check(
    Number.isFinite(missing.scrollSeconds) && missing.scrollSeconds === medium.scrollSeconds,
    "a config with no scrollSpeed on it falls back to medium rather than to NaN",
    `${missing.scrollSeconds.toFixed(2)}s`,
  );
  check(missing.animate, "and still animates, so an old board scrolls instead of standing still");
}

console.log("\n-- speed, and the startup bug elapsed time fixes ----------");

{
  // THE OLD REGRESSION, now unreachable by construction. The offset used to
  // come from the absolute epoch tick, so the first measured frame's target
  // was arbitrary — measured at 224px on a 504-unit list with the old 16
  // units/second — while the frame before measurement had no offset at all.
  // CSS then interpolated the whole distance over one second (a
  // fourteen-times sweep) and settled to the real rate, which reads as
  // stopping. Reported as "scrolls through the list very fast, then slows
  // almost to a stop".
  //
  // A scroll reads no clock now, so there is no epoch to leak back in. What
  // is left to hold is that the starting offset is the top.
  const first = overflowState({ mode: "scroll", elapsedSeconds: 0, ...TWELVE });
  check(first.offset === 0, "a scroll starts at the top, whatever the wall clock says", first.offset);

  // Paging still reads the tick, and elapsed time is what starts it on page
  // one rather than on whichever page the epoch lands on.
  const firstPage = overflowState({ mode: "page", elapsedSeconds: 0, ...TWELVE });
  check(firstPage.offset === 0, "and a paging table starts on page one", firstPage.offset);
  check(
    overflowState({ mode: "page", elapsedSeconds: null, ...TWELVE }).offset === 0,
    "with no tick yet — the server render — a paging table sits still and complete",
  );
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
    check(
      Math.abs(state.scrollSeconds - 504 / expected) < 1e-9,
      `and the cycle is the list over that rate at ${speed}`,
      `${state.scrollSeconds.toFixed(2)}s`,
    );
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
