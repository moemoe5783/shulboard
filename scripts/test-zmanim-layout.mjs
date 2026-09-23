/**
 * The Zmanim table's layout, measured in a real browser.
 *
 * The widget's layout rules are claims about rendered pixels, and the
 * pure-function suite (test-zmanim-fit.ts) cannot reach any of them:
 *
 *  1. ALIGNMENT. "7:22 PM and 11:21 AM differ in digit count, so
 *     right-aligning the whole string makes the two-digit hour hang out."
 *     The hour, the ":MM" and the meridiem each get a shared grid track, so
 *     the colons land on one x and the outer edge is straight.
 *  2. CONFIGURED SIZE, WIDTH-CAPPED, HEIGHT NEVER RESIZES. The type renders at
 *     the configured size; a narrower box shrinks it (width-cap) but a shorter
 *     box does NOT — that was the bug (widgets/zmanim/fit.ts).
 *  3. VERTICAL PAGING. When the rows don't all fit, the viewport shows a whole
 *     number of rows (no partial row peeking) and the type stays put.
 *  4. The Chabad.org credit line, small relative to the times.
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
    const grid = widget?.querySelector(".grid");
    if (!grid) return null;
    const viewport = widget.querySelector("[data-zmanim-viewport]");
    const attribution = widget.querySelector("[data-zmanim-attribution]");

    const mirrored = getComputedStyle(grid).direction === "rtl";
    const cells = [...grid.children];
    const rows = [];
    for (let at = 0; at + 3 < cells.length; at += 4) {
      const [label, a, b, c] = cells.slice(at, at + 4);
      // Emit order mirrors, so name the pieces by what they contain rather
      // than by position: the minutes cell is the one starting with a colon.
      const time = mirrored ? [c, b, a] : [a, b, c];
      rows.push({
        labelRect: label.getBoundingClientRect(),
        hours: { text: time[0].textContent, rect: time[0].getBoundingClientRect() },
        minutes: { text: time[1].textContent, rect: time[1].getBoundingClientRect() },
        meridiem: { text: time[2].textContent, rect: time[2].getBoundingClientRect() },
      });
    }

    // A whole number of rows must show — no partial row peeking past the clip.
    const vp = viewport ? viewport.getBoundingClientRect() : null;
    const EPS = 1;
    const visibleWholeRows = vp
      ? rows.filter((r) => r.labelRect.top >= vp.top - EPS && r.labelRect.bottom <= vp.bottom + EPS).length
      : rows.length;
    const partialRows = vp
      ? rows.filter((r) => r.labelRect.bottom > vp.top + EPS && r.labelRect.top < vp.bottom - EPS &&
          (r.labelRect.top < vp.top - EPS || r.labelRect.bottom > vp.bottom + EPS)).length
      : 0;

    return {
      mirrored,
      rowCount: rows.length,
      rows: rows.map((row) => ({
        hours: row.hours.text,
        minutes: row.minutes.text,
        meridiem: row.meridiem.text,
        hoursRight: row.hours.rect.right,
        hoursLeft: row.hours.rect.left,
        minutesLeft: row.minutes.rect.left,
        meridiemRight: row.meridiem.rect.right,
      })),
      rowFontPx: Number.parseFloat(getComputedStyle(grid).fontSize),
      viewportHeight: vp ? vp.height : null,
      visibleWholeRows,
      partialRows,
      gridCount: widget.querySelectorAll(".grid").length,
      // The scrolling track is the viewport's own child in scroll mode.
      animation: viewport?.firstElementChild ? getComputedStyle(viewport.firstElementChild).animationName : "none",
      attributionText: attribution ? attribution.textContent : null,
      attributionFontPx: attribution ? Number.parseFloat(getComputedStyle(attribution).fontSize) : null,
    };
  });
}

const spread = (values) => Math.max(...values) - Math.min(...values);

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

  console.log("\n-- ITEM 1: the column's outer edge, and the colon ----------");

  for (const script of ["english", "transliteration"]) {
    // A tall box so all eleven rows sit on one page — the grid holds every row
    // regardless of paging, so alignment is measurable across all of them.
    const table = await open(`script=${script}&w=60&h=95`);
    if (!table) {
      check(false, `${script}: the table rendered at all`);
      continue;
    }

    check(table.rowCount === 11, `${script}: all eleven rows rendered`, `${table.rowCount} rows`);
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

  console.log("\n-- ITEM 2: the box WIDTH sets the size, height never does ----");

  {
    // Wider box, bigger type — the width drives it, ~proportionally.
    const narrow = await open("script=english&w=30&h=95");
    const wide = await open("script=english&w=60&h=95");
    check(
      Number(wide?.rowFontPx) > Number(narrow?.rowFontPx),
      "a wider box renders bigger type",
      `${narrow?.rowFontPx?.toFixed(1)}px -> ${wide?.rowFontPx?.toFixed(1)}px`,
    );
    const ratio = Number(wide?.rowFontPx) / Number(narrow?.rowFontPx);
    check(Math.abs(ratio - 2) < 0.25, "and about proportionally — twice the width, about twice the type", `${ratio.toFixed(2)}×`);
  }

  {
    // HEIGHT NEVER RESIZES: same width, two very different heights -> same type.
    // This is the exact bug the report named — a shorter box must not shrink it.
    const short = await open("script=english&w=60&h=30");
    const tall = await open("script=english&w=60&h=95");
    check(
      Math.abs((short?.rowFontPx ?? 0) - (tall?.rowFontPx ?? -1)) < 0.5,
      "a third the box height leaves the type size unchanged — height never resizes",
      `${short?.rowFontPx?.toFixed(1)}px (short) vs ${tall?.rowFontPx?.toFixed(1)}px (tall)`,
    );
  }

  console.log("\n-- ITEM 3: vertical overflow pages whole rows ---------------");

  {
    // Narrow width (so the type is small) and vary only the height: a short box
    // can't fit all eleven rows, so `page` shows a page of WHOLE rows — fewer
    // than eleven, none clipped — and the type is unchanged from the tall box
    // that fits them all (paging, not shrinking).
    const short = await open("overflow=page&script=english&w=20&h=25");
    const tall = await open("overflow=page&script=english&w=20&h=95");
    check(
      (short?.visibleWholeRows ?? 0) > 0 && (short?.visibleWholeRows ?? 0) < 11,
      "a short box shows a page of some — not all — rows",
      `${short?.visibleWholeRows} of 11 visible`,
    );
    check((short?.partialRows ?? 1) === 0, "and no partial row peeks past the clip", `${short?.partialRows} partial`);
    check(
      (tall?.visibleWholeRows ?? 0) === 11,
      "while a tall box shows all eleven at once",
      `${tall?.visibleWholeRows} of 11`,
    );
    check(
      Math.abs((short?.rowFontPx ?? 0) - (tall?.rowFontPx ?? -1)) < 0.5,
      "and paging did not change the type size",
      `${short?.rowFontPx?.toFixed(1)}px vs ${tall?.rowFontPx?.toFixed(1)}px`,
    );
  }

  console.log("\n-- ITEM 3b: scroll is available and runs when it overflows --");

  {
    // A short box in `scroll` mode mounts a second copy and runs the keyframe
    // animation; the same table in a tall box (no overflow) does neither.
    const scrolling = await open("overflow=scroll&script=english&w=20&h=25");
    const still = await open("overflow=scroll&script=english&w=20&h=95");
    check(scrolling?.animation === "zmanim-scroll", "an overflowing scroll box runs the scroll animation", String(scrolling?.animation));
    check((scrolling?.gridCount ?? 0) === 2, "with two copies of the rows for a seamless loop", `${scrolling?.gridCount} grids`);
    check(still?.animation === "none" && (still?.gridCount ?? 0) === 1, "a table that fits does not scroll", `${still?.animation}, ${still?.gridCount} grid`);
  }

  console.log("\n-- ITEM 3c: a heavy frame on a small box never freezes -----");

  {
    // THE "defaults to 400 and won't change" REGRESSION (widgets/style.ts,
    // widgets/zmanim/Renderer.tsx). A frame's padding is a multiple of
    // `config.size`, which in this fit-mode widget is decoupled from the box —
    // so a large stored size on a small box (a box dragged down, a preset with
    // padding) would let padding consume the whole content area. The Renderer
    // then measured a zero-width box, early-returned, and left the type size
    // frozen at whatever it last was (the 400 max, after any big size). The
    // padding is now capped against the box, so the content area stays positive
    // and the width-driven size tracks the box down to something small.
    const heavy = await open("overflow=scroll&script=english&w=12&h=10&size=400&pad=0.5&bg=10141a");
    const fit = await page.evaluate(() => {
      const box = document.querySelector("[data-zmanim-lab] [data-widget-id] [data-fitted-size]");
      if (!box) return null;
      return { fitted: Number(box.dataset.fittedSize), contentWidth: box.clientWidth };
    });
    check(heavy != null && (heavy.rowCount ?? 0) === 11, "the table still renders every row under a heavy frame", `${heavy?.rowCount} rows`);
    check(fit != null && fit.contentWidth > 0, "the frame's padding never consumes the whole content area", `content width ${fit?.contentWidth}px`);
    check(
      fit != null && fit.fitted > 0 && fit.fitted < 200,
      "the type size tracks the small box rather than freezing at the 400 max",
      `fitted ${fit?.fitted}`,
    );
  }

  console.log("\n-- ITEM 4: the Chabad.org credit line ----------------------");

  {
    const table = await open("script=english&w=70&h=95");
    check(
      (table?.attributionText ?? "").toLowerCase().includes("chabad.org"),
      "a credit line names Chabad.org",
      table?.attributionText,
    );
    check(
      Number(table?.attributionFontPx) > 0 && Number(table?.attributionFontPx) < (table?.rowFontPx ?? 0) * 0.6,
      "and it is small relative to the times",
      `${table?.attributionFontPx?.toFixed(1)}px vs ${table?.rowFontPx?.toFixed(1)}px rows`,
    );
    // Pinned to the bottom of the box: paging shows whole rows, so the slack
    // left over goes above the credit rather than under it. Checked on a box
    // that pages (slack is certain) and one where every row fits.
    for (const query of ["overflow=page&script=english&w=20&h=37", "script=english&w=70&h=95"]) {
      await open(query);
      const gap = await page.evaluate(() => {
        const widget = document.querySelector("[data-zmanim-lab] [data-widget-id]");
        const credit = widget.querySelector("[data-zmanim-attribution]").getBoundingClientRect();
        return widget.getBoundingClientRect().bottom - credit.bottom;
      });
      check(Math.abs(gap) <= 1.5, "the credit sits at the bottom of the box", `${query}: ${gap.toFixed(1)}px above the bottom`);
    }
  }
  console.log("\n-- ITEM 5: fonts that arrive late --------------------------");

  {
    // A display boots from its stored bundle and usually measures before the
    // board's web fonts (display: swap) have loaded. The box doesn't change
    // size when they land, so a fit taken in the fallback face stuck — on a TV
    // the table scrolled (or sat at the wrong size) until a window resize.
    const query = "overflow=scroll&script=english&w=30&h=60";
    const settled = await open(query);
    const late = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    await late.route(/\.woff2?$/, async (route) => {
      await sleep(2000);
      await route.continue();
    });
    await late.goto(`${BASE}/zmanim-lab?${query}`);
    await late.waitForTimeout(4500);
    const after = await readTable(late);
    await late.close();
    check(
      settled != null && after != null && Math.abs(after.rowFontPx - settled.rowFontPx) < 0.5,
      "a table re-fits when its fonts load late, matching one that had them",
      `${after?.rowFontPx?.toFixed(2)}px vs ${settled?.rowFontPx?.toFixed(2)}px`,
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
