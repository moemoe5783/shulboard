/**
 * The Zmanim table's layout, measured in a real browser.
 *
 * Three of the widget's rules are claims about rendered pixels, and the
 * pure-function suites (test-zmanim-fit.ts, test-zmanim-overflow.ts) cannot
 * reach any of them. All three were reported from a live board:
 *
 *  1. WIDTH. "Narrowing the box makes the font smaller." Only a box narrow
 *     enough to squeeze the TIME column may change the size
 *     (widgets/zmanim/fit.ts); every roomier width must leave it alone.
 *  2. SWITCHING INTO FIT. "It stops resizing entirely." The fitted size has
 *     to land on the table a room can see. It used to land on the scroll
 *     seam's hidden copy, because both copies were rendered from one element
 *     and the duplicate's ref committed last.
 *  3. ALIGNMENT. "7:22 PM and 11:21 AM differ in digit count, so
 *     right-aligning the whole string makes the two-digit hour hang out."
 *     The hour, the ":MM" and the meridiem each get a shared grid track, so
 *     the colons land on one x and the outer edge is straight.
 *
 * Drives app/(dev)/zmanim-lab/page.tsx. Run with: npm run test:zmanim-layout
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3215);
const BASE = `http://127.0.0.1:${PORT}`;

/** Sub-pixel tolerance. Rects are fractional and a grid track boundary can
 *  land a hair either side of it; anything a room could see is orders of
 *  magnitude bigger than this. */
const EPSILON = 0.05;

const results = [];
function check(ok, label, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith("chromium")) continue;
    const path = join(root, entry, "chrome-linux/chrome");
    if (existsSync(path)) return path;
  }
  return null;
}

async function startServer() {
  try {
    await fetch(BASE);
    throw new Error(`Something is already listening on ${PORT}. Stop it and re-run.`);
  } catch (error) {
    if (String(error.message).includes("already listening")) throw error;
  }

  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let output = "";
  child.stdout?.on("data", (c) => (output += c));
  child.stderr?.on("data", (c) => (output += c));
  let exitCode = null;
  child.on("exit", (code) => (exitCode = code));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(500);
    if (exitCode !== null) {
      const hint = /production build/.test(output) ? " Run `npm run build` first." : "";
      throw new Error(`the server exited with ${exitCode}.${hint}\n${output}`);
    }
    try {
      await fetch(`${BASE}/zmanim-lab`);
      return child;
    } catch {
      // not up yet
    }
  }
  throw new Error(`the server never came up:\n${output}`);
}

async function stopServer(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(BASE);
    } catch {
      return;
    }
    await sleep(250);
  }
}

/**
 * Everything one rendered table can say about itself.
 *
 * Reads the VISIBLE copy specifically — `[data-zmanim-lab] [data-widget-id]`
 * then its first grid, which is the one inside `children` rather than the
 * `aria-hidden` seam. That distinction is the whole of item 2: a test that
 * accepted either grid would have passed against the bug.
 *
 * Cells come back in document order, four per row (label, hours, minutes,
 * meridiem — reversed for a mirrored table), so the chunking below is the
 * Renderer's own emit order rather than a guess about selectors.
 */
async function readTable(page) {
  return page.evaluate(() => {
    const lab = document.querySelector("[data-zmanim-lab]");
    const frame = lab?.querySelector("[data-widget-id]");
    const box = frame?.firstElementChild;
    if (!box) return null;
    const grids = box.querySelectorAll(".grid");
    const grid = grids[0];
    if (!grid) return null;

    const mirrored = getComputedStyle(grid).direction === "rtl";
    const cells = [...grid.children];
    const rows = [];
    for (let at = 0; at + 3 < cells.length; at += 4) {
      const [label, a, b, c] = cells.slice(at, at + 4);
      // Emit order mirrors, so name the pieces by what they contain rather
      // than by position: the minutes cell is the one starting with a colon.
      const time = mirrored ? [c, b, a] : [a, b, c];
      rows.push({
        label: label.textContent,
        hours: { text: time[0].textContent, rect: time[0].getBoundingClientRect() },
        minutes: { text: time[1].textContent, rect: time[1].getBoundingClientRect() },
        meridiem: { text: time[2].textContent, rect: time[2].getBoundingClientRect() },
      });
    }

    // The OverflowViewport's transform/animation wrapper: the box's own
    // first child, which is where the scroll cycle is declared.
    const wrapper = box.firstElementChild;
    return {
      mirrored,
      rows: rows.map((row) => ({
        label: row.label,
        hours: row.hours.text,
        minutes: row.minutes.text,
        meridiem: row.meridiem.text,
        hoursRight: row.hours.rect.right,
        hoursLeft: row.hours.rect.left,
        minutesLeft: row.minutes.rect.left,
        minutesRight: row.minutes.rect.right,
        meridiemRight: row.meridiem.rect.right,
        meridiemLeft: row.meridiem.rect.left,
      })),
      fittedSize: box.dataset.fittedSize ?? null,
      boxFontSize: Number.parseFloat(getComputedStyle(box).fontSize),
      visibleFontSize: Number.parseFloat(getComputedStyle(grid).fontSize),
      // Every `.grid` in the box: one while still, two while the seam is
      // live. Their heights must match or the wrap is not seamless.
      gridHeights: [...grids].map((one) => one.getBoundingClientRect().height),
      gridFontSizes: [...grids].map((one) => Number.parseFloat(getComputedStyle(one).fontSize)),
      animation: wrapper ? getComputedStyle(wrapper).animationName : null,
      animationDuration: wrapper ? getComputedStyle(wrapper).animationDuration : null,
    };
  });
}

const spread = (values) => Math.max(...values) - Math.min(...values);

/** The lab's board is 1280 real pixels against a 1920-unit canvas, so a
 *  design unit renders as two thirds of a CSS pixel. This is what turns
 *  `data-fitted-size` into the number the visible grid's computed font size
 *  must match — the assertion that the measured size landed on the table a
 *  room can see, rather than on the seam's hidden copy. */
const designToPx = (units) => (Number(units) / 1920) * 1280;

const executablePath = findChromium();
if (!executablePath) {
  console.log("No Chromium found. Set CHROME_PATH to run the zmanim-layout test.");
  process.exit(0);
}

const { chromium } = await import("playwright-core");
const server = await startServer();
const browser = await chromium.launch({ executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on("pageerror", (e) => check(false, "no page errors", e.message));

  const open = async (query) => {
    await page.goto(`${BASE}/zmanim-lab?${query}`, { waitUntil: "networkidle" });
    // One tick for the master clock to arrive and the ResizeObservers to
    // settle — the table is empty until `useSecond()` fires.
    await page.waitForTimeout(1400);
    return readTable(page);
  };

  console.log("\n-- ITEM 3: the column's outer edge, and the colon ----------");

  for (const script of ["english", "hebrew"]) {
    const table = await open(`sizing=fixed&overflow=clip&script=${script}&w=60&h=80`);
    if (!table) {
      check(false, `${script}: the table rendered at all`);
      continue;
    }

    check(table.rows.length === 11, `${script}: all eleven rows rendered`, `${table.rows.length} rows`);
    check(
      table.mirrored === (script === "hebrew"),
      `${script}: the grid's direction is ${script === "hebrew" ? "rtl" : "ltr"}`,
      `mirrored: ${table.mirrored}`,
    );

    // The case the report named: the table genuinely mixes hour widths, so
    // a straight edge here is an actual result rather than a tautology.
    const hourWidths = new Set(table.rows.map((row) => row.hours.length));
    check(
      hourWidths.size === 2 && hourWidths.has(1) && hourWidths.has(2),
      `${script}: the table mixes one- and two-digit hours, which is what makes this a test`,
      [...hourWidths].join(" and "),
    );

    /*
     * EVERY EDGE BELOW IS THE SAME PHYSICAL EDGE IN BOTH SCRIPTS, and that
     * is not laziness about mirroring — it follows from the time staying
     * LTR. A clock time reads hour, colon, minutes, meridiem from left to
     * right in Hebrew too (no luach prints it backwards), so the hour's
     * inner edge is its RIGHT edge either way and the colon is always the
     * minutes cell's LEFT.
     *
     * What mirroring changes is which side of the label the block sits on,
     * and therefore which of the two ends faces the box's own margin. In
     * English the aligned end (the meridiem) is the outer one and the
     * hour's indent faces the label gap; in Hebrew the labels are on the
     * right, so the aligned end faces the label and the hour's indent
     * faces the margin. Both are the same table reflected about the
     * label; neither reverses a time, which is the only thing that could
     * have made them literal mirrors.
     */
    const alignedEnd = table.rows.map((row) => row.meridiemRight);
    check(
      spread(alignedEnd) < EPSILON,
      `${script}: the column's aligned edge is straight to within a sub-pixel`,
      `${spread(alignedEnd).toFixed(3)}px across 11 rows`,
    );

    const colon = table.rows.map((row) => row.minutesLeft);
    check(
      spread(colon) < EPSILON,
      `${script}: the colon sits at one x whatever the hour's width`,
      `${spread(colon).toFixed(3)}px`,
    );

    const hourInner = table.rows.map((row) => row.hoursRight);
    check(
      spread(hourInner) < EPSILON,
      `${script}: and the hours share their inner edge — right-aligned in one track`,
      `${spread(hourInner).toFixed(3)}px`,
    );

    // The raggedness that has to go SOMEWHERE: a single-digit hour is
    // narrower, so its own left edge sits in from a two-digit one. If these
    // matched, every row would be the same string and nothing above would
    // be a test.
    const hourIndent = table.rows.map((row) => row.hoursLeft);
    check(
      spread(hourIndent) > 1,
      `${script}: while a one-digit hour indents from a two-digit one — that is the absorbed raggedness`,
      `${spread(hourIndent).toFixed(2)}px`,
    );

    if (script === "hebrew") {
      check(
        table.rows.every((row) => /[֐-׿]/.test(row.label ?? "")),
        "hebrew: the labels really are Hebrew, so the mirrored measurement means something",
        table.rows[0]?.label ?? "",
      );
      // The time itself never reverses — a clock time is Latin digits in a
      // fixed order and no luach prints it backwards.
      check(
        table.rows.every((row) => row.hoursLeft < row.minutesLeft && row.minutesLeft < row.meridiemLeft),
        "hebrew: and the time still reads hour, minutes, meridiem from left to right",
      );
    }
  }

  console.log("\n-- ITEM 1: narrowing a roomy box changes nothing -----------");

  {
    /*
     * The band the bug lived in. At a fixed height, the fitted size is the
     * height-driven one until the box is narrow enough to squeeze the time
     * column. These widths walk down through what the old measurement
     * (the whole untruncated row) would have called "too narrow".
     */
    const sizes = [];
    for (const w of [70, 60, 50, 40, 32]) {
      const table = await open(`sizing=fit&overflow=clip&script=english&w=${w}&h=70`);
      sizes.push({ w, fitted: table?.fittedSize, font: table?.visibleFontSize });
    }
    const first = sizes[0];
    for (const one of sizes) {
      check(
        one.fitted === first.fitted,
        `a box at ${one.w}% width fits to the same type size as one at ${first.w}%`,
        `${one.fitted} design units (${one.font?.toFixed(1)}px)`,
      );
    }
    check(
      Number(first.fitted) > 0,
      "and that size is a real fitted value rather than a missing one",
      String(first.fitted),
    );

    // Narrow enough that the time column itself cannot fit: the size MUST
    // come down. Rule 3 is still in force; it just starts where the
    // clipping would.
    const squeezed = await open("sizing=fit&overflow=clip&script=english&w=8&h=70");
    check(
      Number(squeezed?.fittedSize) < Number(first.fitted),
      "while a box too narrow for the time column does shrink the type",
      `${squeezed?.fittedSize} against ${first.fitted}`,
    );
  }

  {
    // Rule 1, in a real box: twice the height, twice the type.
    const short = await open("sizing=fit&overflow=clip&script=english&w=60&h=35");
    const tall = await open("sizing=fit&overflow=clip&script=english&w=60&h=70");
    const ratio = Number(tall?.fittedSize) / Number(short?.fittedSize);
    check(
      Math.abs(ratio - 2) < 0.05,
      "twice the box height gives twice the type size — height is what drives it",
      `${short?.fittedSize} -> ${tall?.fittedSize} (${ratio.toFixed(2)}×)`,
    );
  }

  console.log("\n-- ITEM 2: fit sizes the table a room can SEE --------------");

  {
    /*
     * THE REGRESSION. In `fit` + `scroll` the seam mounts a second copy of
     * the list. Both copies used to come from one element, so every ref
     * inside committed twice and the hidden one won — the measured size was
     * written to the copy nobody sees, and the visible table sat at its
     * inherited size (16px) forever. Switching modes made it collapse on
     * the spot; a resize afterwards changed nothing at all.
     */
    const table = await open("sizing=fit&overflow=scroll&script=english&w=45&h=45");
    check((table?.gridHeights.length ?? 0) === 2, "the seam is live: two copies of the list are mounted",
      `${table?.gridHeights.length} grids`);
    check(
      Math.abs((table?.visibleFontSize ?? 0) - (table?.boxFontSize ?? -1)) < EPSILON &&
        (table?.visibleFontSize ?? 0) > 25,
      "and the VISIBLE copy carries the fitted size rather than an inherited default",
      `${table?.visibleFontSize?.toFixed(1)}px on screen, box at ${table?.boxFontSize?.toFixed(1)}px`,
    );
    check(
      spread(table?.gridFontSizes ?? [0]) < EPSILON,
      "both copies are at the same size, which is what makes the wrap invisible",
      (table?.gridFontSizes ?? []).map((n) => n.toFixed(1)).join(" / "),
    );
    check(
      spread(table?.gridHeights ?? [0]) < EPSILON,
      "and therefore the same height",
      (table?.gridHeights ?? []).map((n) => n.toFixed(1)).join(" / "),
    );
    check(
      Math.abs((table?.visibleFontSize ?? 0) - designToPx(table?.fittedSize)) < 1,
      "and the size the panel reports is the size the visible table is actually at",
      `${table?.fittedSize} units = ${designToPx(table?.fittedSize).toFixed(1)}px, measured ${table?.visibleFontSize?.toFixed(1)}px`,
    );

    console.log("\n-- ITEM 4: the scroll is one CSS cycle, not a per-tick step -");
    check(
      table?.animation === "zmanim-scroll",
      "the list is driven by the keyframes in app/globals.css",
      String(table?.animation),
    );
    check(
      Number.parseFloat(table?.animationDuration ?? "0") > 0,
      "with a real duration, so one cycle is exactly one copy of the list",
      String(table?.animationDuration),
    );
  }

  {
    // And the switch itself, which is how it was reported. `fit` is the
    // lab's default, so this starts in `fixed` and presses the button.
    // A shorter box than the block above, so the table overflows in `fixed`
    // too and the seam is ALREADY mounted when the switch happens. That is
    // the precondition the bug needed: a fresh mount in `fit` wrote the size
    // before the duplicate existed and merely went stale afterwards, whereas
    // switching wrote it straight into the hidden copy.
    const before = await open("sizing=fixed&overflow=scroll&script=english&w=45&h=30");
    check(before?.fittedSize === undefined || before?.fittedSize === null,
      "in fixed mode there is no fitted size to report", String(before?.fittedSize));
    check((before?.gridHeights.length ?? 0) === 2,
      "and the seam is already mounted before the switch, which is what made this break",
      `${before?.gridHeights.length} grids`);

    await page.click("[data-toggle-sizing]");
    await page.waitForTimeout(900);
    const after = await readTable(page);
    check(
      Number(after?.fittedSize) > 0 &&
        Math.abs((after?.visibleFontSize ?? 0) - (after?.boxFontSize ?? -1)) < EPSILON,
      "switching into fit resizes the visible table rather than the hidden copy",
      `${after?.fittedSize} design units, ${after?.visibleFontSize?.toFixed(1)}px on screen`,
    );
    check(
      spread(after?.gridFontSizes ?? [0]) < EPSILON,
      "and both copies move together, so the seam survives the switch",
      (after?.gridFontSizes ?? []).map((n) => n.toFixed(1)).join(" / "),
    );
    check(
      Math.abs((after?.visibleFontSize ?? 0) - designToPx(after?.fittedSize)) < 1,
      "and the measured size is on the visible table — the assertion the old duplicate-ref bug failed",
      `${after?.fittedSize} units = ${designToPx(after?.fittedSize).toFixed(1)}px, measured ${after?.visibleFontSize?.toFixed(1)}px`,
    );
    check(
      after?.visibleFontSize !== before?.visibleFontSize,
      "and the size actually changed, so the switch did something",
      `${before?.visibleFontSize?.toFixed(1)}px -> ${after?.visibleFontSize?.toFixed(1)}px`,
    );
  }
} finally {
  await browser.close();
  await stopServer(server);
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
