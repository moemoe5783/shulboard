/**
 * The Zmanim table's layout, measured in a real browser.
 *
 * Two of the widget's rules are claims about rendered pixels, and the
 * pure-function suite (test-zmanim-fit.ts) cannot reach either:
 *
 *  1. FIT BOTH AXES. The type is the largest at which the whole table fits the
 *     box — so a narrower box gives smaller type (width binds) AND a shorter
 *     box gives smaller type (height binds). There is no sizing mode and no
 *     scroll/page overflow any more (widgets/zmanim/fit.ts): a busier day or a
 *     smaller box simply renders smaller.
 *  2. ALIGNMENT. "7:22 PM and 11:21 AM differ in digit count, so
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
 * Cells come back in document order, four per row (label, hours, minutes,
 * meridiem — reversed for a mirrored table), so the chunking below is the
 * Renderer's own emit order rather than a guess about selectors.
 */
async function readTable(page) {
  return page.evaluate(() => {
    const lab = document.querySelector("[data-zmanim-lab]");
    const widget = lab?.querySelector("[data-widget-id]");
    // BoardRenderer.WidgetFrame wraps every widget in the shared appearance
    // frame (widgets/style.ts, transparent when unstyled), so the box carrying
    // the fitted font size sits a few levels in. Find it by the attribute the
    // fit writes rather than by counting wrappers.
    const box = widget?.querySelector("[data-fitted-size]");
    if (!box) return null;
    const grid = box.querySelector(".grid");
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

  console.log("\n-- ITEM 2: the column's outer edge, and the colon ----------");

  for (const script of ["english", "transliteration"]) {
    const table = await open(`script=${script}&w=60&h=80`);
    if (!table) {
      check(false, `${script}: the table rendered at all`);
      continue;
    }

    check(table.rows.length === 11, `${script}: all eleven rows rendered`, `${table.rows.length} rows`);
    check(
      !table.mirrored,
      `${script}: the grid is LTR — both label forms are Latin, nothing mirrors`,
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

    // The time is LTR in both label forms: hour, colon, minutes, meridiem
    // from left to right, so the hour's inner edge is its RIGHT edge, the
    // colon is the minutes cell's LEFT, and the meridiem's RIGHT is the
    // column's aligned outer edge.
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
  }

  console.log("\n-- ITEM 1: fit shrinks the type on BOTH axes ----------------");

  {
    // WIDTH BINDS in a tall box: a narrower box gives smaller type. Both boxes
    // are tall (h=90) so the widest row is the constraint in each, and the
    // width ratio is ~2, so the fitted type is ~2× as well.
    const narrow = await open("script=english&w=20&h=90");
    const wide = await open("script=english&w=40&h=90");
    check(Number(narrow?.fittedSize) > 0, "the narrow box has a real fitted size", String(narrow?.fittedSize));
    check(
      Number(wide?.fittedSize) > Number(narrow?.fittedSize),
      "a wider box (width-bound) fits to bigger type",
      `${narrow?.fittedSize} -> ${wide?.fittedSize}`,
    );
    const wRatio = Number(wide?.fittedSize) / Number(narrow?.fittedSize);
    check(Math.abs(wRatio - 2) < 0.2, "and proportionally — twice the width is about twice the type", `${wRatio.toFixed(2)}×`);
  }

  {
    // HEIGHT BINDS in a wide box: a shorter box gives smaller type. Both boxes
    // are wide (w=90) so the stacked height is the constraint in each. This is
    // the axis the old width-only fit ignored — the whole point of "both axes".
    const short = await open("script=english&w=90&h=35");
    const tall = await open("script=english&w=90&h=70");
    check(
      Number(tall?.fittedSize) > Number(short?.fittedSize),
      "a taller box (height-bound) fits to bigger type — height drives it too",
      `${short?.fittedSize} -> ${tall?.fittedSize}`,
    );
    const hRatio = Number(tall?.fittedSize) / Number(short?.fittedSize);
    check(Math.abs(hRatio - 2) < 0.25, "and proportionally — twice the height is about twice the type", `${hRatio.toFixed(2)}×`);
  }

  {
    // A box too small for the table even at minFontSize settles at the minimum
    // and the shared clip takes over — the one case "never clip" can't hold.
    const roomy = await open("script=english&w=40&h=90");
    const squeezed = await open("script=english&w=6&h=8");
    check(
      Number(squeezed?.fittedSize) < Number(roomy?.fittedSize),
      "a tiny box on both axes comes down to the minimum",
      `${squeezed?.fittedSize} against ${roomy?.fittedSize}`,
    );
  }

  console.log("\n-- ITEM 3: the fitted size lands on the visible table ------");

  {
    // The size written to the box is the size the grid actually renders at, and
    // it matches what the properties panel reads back (data-fitted-size).
    const table = await open("script=english&w=45&h=60");
    check(
      Math.abs((table?.visibleFontSize ?? 0) - (table?.boxFontSize ?? -1)) < EPSILON && (table?.visibleFontSize ?? 0) > 0,
      "the grid renders at the size written to the box",
      `${table?.visibleFontSize?.toFixed(1)}px on screen, box at ${table?.boxFontSize?.toFixed(1)}px`,
    );
    check(
      Math.abs((table?.visibleFontSize ?? 0) - designToPx(table?.fittedSize)) < 1,
      "and the size the panel reports is the size the visible table is actually at",
      `${table?.fittedSize} units = ${designToPx(table?.fittedSize).toFixed(1)}px, measured ${table?.visibleFontSize?.toFixed(1)}px`,
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
