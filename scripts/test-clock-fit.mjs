/**
 * The Clock's sizing, measured in a real browser (app/(dev)/clock-lab):
 *
 *  1. `fit` FOLLOWS THE BOX on both axes — the time grows until it touches the
 *     box's width or (by its figures, not the font's line box) its height, and
 *     never passes either edge. A big box isn't held back by a low ceiling.
 *  2. `fit` HOLDS STILL when the hour gains a digit — it fits the widest time
 *     the format can show, not the one on screen.
 *  3. NUMBERS FOLLOW THE FONT when its digits are all one width, and fall back
 *     to Frank Ruhl Libre when they aren't — for the widget's own font and for
 *     the board's.
 *
 * Needs a production build; starts its own `next start`.
 * Run with: npm run test:clock-fit
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3226);
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const check = (ok, label, detail = "") => {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
};

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

const executablePath = findChromium();
if (!executablePath) {
  console.log("No Chromium found. Set CHROME_PATH to run the clock fit test.");
  process.exit(0);
}

const child = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
for (let i = 0; i < 60; i += 1) {
  await sleep(500);
  try {
    await fetch(`${BASE}/clock-lab`);
    break;
  } catch {}
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (error) => check(false, "no page errors", error.message));
  const open = async (query) => {
    await page.goto(`${BASE}/clock-lab?${query}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    return page.evaluate(() => {
      const span = document.querySelector("[data-clock-lab] [data-widget-id] span");
      const box = span.parentElement;
      const b = box.getBoundingClientRect();
      const t = span.getBoundingClientRect();
      return {
        boxW: b.width,
        boxH: b.height,
        textW: t.width,
        textH: t.height,
        overhang: Math.max(b.left - t.left, t.right - b.right, b.top - t.top, t.bottom - b.bottom),
        fontPx: parseFloat(getComputedStyle(span).fontSize),
        fitted: Number(box.dataset.fittedSize),
        family: getComputedStyle(span).fontFamily.split(",")[0].replace(/"/g, ""),
        text: span.textContent,
      };
    });
  };

  console.log("\n-- fit follows the box ----------------------------------------");
  {
    const narrow = await open("w=40&h=40");
    check(narrow.overhang <= 1, "a width-bound clock never passes the box's edges", `${narrow.overhang.toFixed(1)}px`);
    check(Math.abs(narrow.textW - narrow.boxW) <= 2, "and it grows to the box's full width", `${narrow.textW.toFixed(0)} of ${narrow.boxW.toFixed(0)}px`);

    const wider = await open("w=60&h=40");
    check(wider.fontPx > narrow.fontPx * 1.3, "a wider box means bigger type", `${narrow.fontPx.toFixed(0)} -> ${wider.fontPx.toFixed(0)}px`);

    const short = await open("w=90&h=15");
    check(short.overhang <= 1, "a height-bound clock never passes the box's edges", `${short.overhang.toFixed(1)}px`);
    check(
      short.textH >= short.boxH * 0.85,
      "its figures fill the box's height, not the font's line box",
      `${short.textH.toFixed(0)} of ${short.boxH.toFixed(0)}px`,
    );
    const taller = await open("w=90&h=25");
    check(taller.fontPx > short.fontPx * 1.3, "a taller box means bigger type", `${short.fontPx.toFixed(0)} -> ${taller.fontPx.toFixed(0)}px`);

    const huge = await open("w=95&h=90&h12=0");
    check(huge.fitted > 400, "a clock filling the screen isn't capped at 400", `fitted ${huge.fitted}`);
    check(huge.overhang <= 1, "and still fits", `${huge.overhang.toFixed(1)}px`);
  }

  console.log("\n-- fit holds still when the hour gains a digit ----------------");
  {
    // Two zones where it's a one-digit and a two-digit hour right now.
    const hourIn = (zone) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: true, timeZone: zone }).format(new Date()).split(" ")[0]);
    const zones = Array.from({ length: 24 }, (_, i) => `Etc/GMT${i - 12 >= 0 ? "+" : ""}${i - 12}`).filter((z) => {
      try {
        hourIn(z);
        return true;
      } catch {
        return false;
      }
    });
    const one = zones.find((z) => hourIn(z) < 10);
    const two = zones.find((z) => hourIn(z) >= 10);
    const a = await open(`w=40&h=40&tz=${encodeURIComponent(one)}`);
    const b = await open(`w=40&h=40&tz=${encodeURIComponent(two)}`);
    check(a.text.split(":")[0].length === 1 && b.text.split(":")[0].length === 2, "(set-up: a one-digit and a two-digit hour)", `${a.text} / ${b.text}`);
    check(Math.abs(a.fontPx - b.fontPx) < 0.5, "the type is the same size either way", `${a.fontPx.toFixed(1)} vs ${b.fontPx.toFixed(1)}px`);
  }

  console.log("\n-- numbers follow the font when its digits are one width -------");
  {
    for (const [query, expected, why] of [
      ["font=heebo", "Heebo", "a widget set in Heebo shows its time in Heebo"],
      ["font=rubik", "Rubik", "and Rubik"],
      ["font=alef", "Frank Ruhl Libre", "a widget set in Alef (no tabular figures) falls back to Frank Ruhl Libre"],
      ["boardFont=davidLibre", "David Libre", "a board set in David Libre shows its clocks in it"],
      ["boardFont=suezOne", "Frank Ruhl Libre", "a board set in Suez One falls back"],
      ["boardFont=heebo&font=alef", "Frank Ruhl Libre", "a widget's own font wins over the board's"],
    ]) {
      const clock = await open(`w=40&h=20&${query}`);
      check(clock.family === expected, why, clock.family);
    }
  }
} finally {
  await browser.close();
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
}
console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
