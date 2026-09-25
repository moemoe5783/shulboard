/**
 * The font system in a real browser, off /fonts-lab (app/(dev)/fonts-lab):
 *
 *  1. NO EXTERNAL FONT HOST. Loading every font, weight, nikud line, zmanim
 *     table and theme requests fonts from this origin only.
 *  2. A BOARD DOWNLOADS ONLY ITS OWN FONTS, and Hebrew files only when there's
 *     Hebrew: one small Inter board fetches Inter and nothing else; add a
 *     Hebrew line and Heebo's Hebrew file joins it.
 *  3. TIMES LINE UP IN EVERY FONT: in the real Zmanim widget set in each
 *     catalog face, the hours' right edges and the minutes' left edges are one
 *     line, and hours of the same length are the same width whatever digits
 *     they hold (lining, tabular — or boxed, or the fallback's digits).
 *  4. EVERY HEBREW FONT AND EVERY THEME DRAWS IN ITS OWN FACE, loaded.
 *
 * Needs a production build; starts its own `next start`.
 * Run with: npm run test:fonts-lab
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3231);
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
  console.log("No Chromium found. Set CHROME_PATH to run the fonts lab test.");
  process.exit(0);
}

const child = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
for (let i = 0; i < 60; i += 1) {
  await sleep(500);
  try {
    await fetch(`${BASE}/fonts-lab?section=plain`);
    break;
  } catch {}
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ executablePath });

/** Open a lab page, recording every request, and wait for its fonts. */
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => check(false, "no page errors", error.message));
  await page.goto(`${BASE}/fonts-lab?${query}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return { page, requests };
}

const fontFiles = (requests) => requests.map((url) => new URL(url)).filter((url) => /\.woff2?$/.test(url.pathname));

try {
  console.log("\n-- 1. nothing from an external font host -----------------------------");
  {
    const { page, requests } = await open("");
    // Scroll through so every lazily drawn row has asked for its face.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });
    await page.waitForTimeout(800);
    const external = requests.filter((url) => new URL(url).origin !== BASE);
    const files = fontFiles(requests);
    check(files.length > 40, "the whole lab loads dozens of font files", `${files.length}`);
    check(external.length === 0, "and every request stays on this origin — no Google Fonts, no font CDN", external.slice(0, 3).join(", ") || "none");
    await page.close();
  }

  console.log("\n-- 2. a board downloads only its own fonts ----------------------------");
  {
    const english = await open("section=plain");
    const files = fontFiles(english.requests).map((url) => url.pathname).filter((path) => path.startsWith("/fonts/"));
    check(files.length > 0 && files.every((path) => path.startsWith("/fonts/inter/")), "an English Inter board fetches Inter and nothing else", files.join(", "));
    check(!files.some((path) => path.includes("/hebrew-")), "and no Hebrew file");
    await english.page.close();

    const hebrew = await open("section=plain&hebrew=1");
    const withHebrew = fontFiles(hebrew.requests).map((url) => url.pathname).filter((path) => path.startsWith("/fonts/"));
    check(withHebrew.some((path) => path.startsWith("/fonts/heebo/hebrew-")), "Hebrew on it: Heebo's Hebrew file, the matched fallback, joins", withHebrew.join(", "));
    check(!withHebrew.some((path) => path.startsWith("/fonts/") && !/^\/fonts\/(inter|heebo)\//.test(path)), "and still nothing else");
    await hebrew.page.close();
  }

  console.log("\n-- 3. times line up in every font -------------------------------------");
  {
    const { page } = await open("section=zmanim");
    const tables = await page.evaluate(() =>
      [...document.querySelectorAll("[data-lab-zmanim]")].map((figure) => {
        const grid = figure.querySelector(".grid");
        const cells = grid ? [...grid.children] : [];
        const inkWidth = (el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect().width;
        };
        const rows = [];
        for (let at = 0; at + 3 < cells.length; at += 4) {
          const [, hours, minutes] = cells.slice(at, at + 4);
          rows.push({
            hours: hours.textContent,
            hoursRight: hours.getBoundingClientRect().right,
            hoursInk: inkWidth(hours),
            minutesLeft: minutes.getBoundingClientRect().left,
            minutesInk: inkWidth(minutes),
          });
        }
        return { font: figure.dataset.labZmanim, rows };
      }),
    );
    check(tables.length >= 40, "a table in every catalog font", `${tables.length}`);
    const spread = (values) => Math.max(...values) - Math.min(...values);
    const bad = [];
    for (const table of tables) {
      if (table.rows.length < 5) {
        bad.push(`${table.font}: ${table.rows.length} rows`);
        continue;
      }
      const edges = Math.max(spread(table.rows.map((r) => r.hoursRight)), spread(table.rows.map((r) => r.minutesLeft)));
      const byLength = new Map();
      for (const row of table.rows) byLength.set(row.hours.length, [...(byLength.get(row.hours.length) ?? []), row.hoursInk]);
      const hourWidths = Math.max(...[...byLength.values()].map(spread));
      const minuteWidths = spread(table.rows.map((r) => r.minutesInk));
      if (edges > 0.5 || hourWidths > 0.5 || minuteWidths > 0.5) {
        bad.push(`${table.font} (edges ${edges.toFixed(2)}, hours ${hourWidths.toFixed(2)}, minutes ${minuteWidths.toFixed(2)}px)`);
      }
    }
    check(bad.length === 0, "in every one, the hours and minutes stand in straight columns, digits all one width", bad.join("; ") || "all line up");
    await page.close();
  }

  console.log("\n-- 4. every Hebrew font and every theme in its own face ---------------");
  {
    const { page } = await open("section=nikud");
    const nikud = await page.evaluate(() =>
      [...document.querySelectorAll("[data-lab-nikud] td[lang=he]")].map((cell) => {
        const family = getComputedStyle(cell).fontFamily.split(",")[0].replace(/"/g, "");
        return { family, loaded: document.fonts.check(`64px "${family}"`, cell.textContent) };
      }),
    );
    check(nikud.length === 17, "a nikud pasuk in every Hebrew font (the override list, plus Alef and Miriam Libre)", `${nikud.length}`);
    check(nikud.every((row) => row.loaded), "each drawn in its own loaded face", nikud.filter((r) => !r.loaded).map((r) => r.family).join(", ") || "all");
    await page.close();

    const themes = await open("section=themes");
    const titles = await themes.page.evaluate(() =>
      [...document.querySelectorAll("[data-lab-theme]")].map((figure) => {
        const title = figure.querySelector('[data-widget-id="00000000-0000-4000-8000-000000000001"] span');
        return { theme: figure.dataset.labTheme, family: title ? getComputedStyle(title).fontFamily : "" };
      }),
    );
    const expected = { "classic-shul": "Cinzel", elegant: "Playfair Display", modern: "Montserrat", warm: "Outfit", simcha: "DM Serif Display", scholarly: "EB Garamond" };
    check(titles.length === 6, "six themes on the sample board");
    for (const { theme, family } of titles) check(family.includes(expected[theme]), `${theme}: the title is in ${expected[theme]}`, family);
    await themes.page.close();
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
