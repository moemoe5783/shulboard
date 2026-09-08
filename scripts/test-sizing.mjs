/**
 * Sizing modes — docs/sizing.md §2 as executable acceptance criteria.
 *
 * Drives the real BoardEditor (not editor-lab, which has its own inline
 * chrome and never mounts components/editor/PropertiesPanel.tsx) via
 * app/(dev)/font-parity/page.tsx — a permanent dev page that already wraps
 * the production editor around a controllable document, which is exactly
 * what a test of the real properties panel needs and editor-lab cannot give.
 *
 * Covers: a real, visible type size in every mode (docs/sizing.md's
 * properties-panel requirement) — read-only and computed in `fit`, editable
 * in `fixed` and the new `hug` mode — and hug's own mechanism: the box's
 * height tracks the declared size instead of the stored percentage, so
 * overflow is structurally impossible rather than something to warn about.
 *
 * Run with: npm run test:sizing
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3215);
const BASE = `http://127.0.0.1:${PORT}`;
const PARITY = `${BASE}/font-parity`;

const TITLE_ID = "11111111-1111-4111-8111-111111111111";
const CLOCK_FIXED_ID = "22222222-2222-4222-8222-222222222222";

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
      await fetch(PARITY);
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

const executablePath = findChromium();
if (!executablePath) {
  console.log("No Chromium found. Set CHROME_PATH to run the sizing tests.");
  process.exit(0);
}

const { chromium } = await import("playwright-core");
const server = await startServer();
const browser = await chromium.launch({ executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  page.on("pageerror", (error) => check(false, "no page errors", error.message));

  await page.goto(PARITY, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-widget-id]");
  await page.waitForTimeout(300);

  const settle = () => page.waitForTimeout(150);
  const editorHalf = () => page.locator('[data-parity-half="editor"]');
  const widget = (id) => editorHalf().locator(`[data-widget-id="${id}"]`);
  const typeSizeInput = () => page.locator("label", { hasText: "Type size" }).locator("input");
  const fontSizeOf = (locator) =>
    locator.evaluate((el) => parseFloat(getComputedStyle(el.querySelector("span")).fontSize));

  // ---- fit mode: read-only, and a real computed number -------------------

  await widget(TITLE_ID).click();
  await settle();
  check(await typeSizeInput().isDisabled(), "title's type size is read-only in fit mode");
  const titleSize = Number(await typeSizeInput().inputValue());
  check(titleSize > 0, "title's type size shows a real computed number, not zero", `${titleSize}`);
  check(
    (await page.locator("span", { hasText: "Sizing" }).count()) === 0,
    "no Sizing toggle appears for a widget with only one mode",
  );

  // ---- fixed mode: editable, wired to config.size -------------------------

  await widget(CLOCK_FIXED_ID).click();
  await settle();
  check(!(await typeSizeInput().isDisabled()), "clock's type size is editable in fixed mode");
  check((await typeSizeInput().inputValue()) === "96", "showing the document's own declared size", await typeSizeInput().inputValue());

  const beforeResize = await fontSizeOf(widget(CLOCK_FIXED_ID));
  await typeSizeInput().fill("220");
  await typeSizeInput().blur();
  await settle();
  const afterResize = await fontSizeOf(widget(CLOCK_FIXED_ID));
  check(
    afterResize > beforeResize,
    "editing the type size changes the rendered clock",
    `${beforeResize.toFixed(1)}px -> ${afterResize.toFixed(1)}px`,
  );

  // ---- hug mode: the box tracks content instead of the stored percentage --

  await page.locator("button", { hasText: "Hug height" }).click();
  await settle();
  const heightStyle = () => widget(CLOCK_FIXED_ID).evaluate((el) => el.style.height);
  check((await heightStyle()) === "auto", "hug mode sets height to auto, not a percentage");
  check(!(await typeSizeInput().isDisabled()), "type size stays editable in hug mode");

  const shortHeight = (await widget(CLOCK_FIXED_ID).boundingBox()).height;
  await typeSizeInput().fill("320");
  await typeSizeInput().blur();
  await settle();
  const tallHeight = (await widget(CLOCK_FIXED_ID).boundingBox()).height;
  check(
    tallHeight > shortHeight,
    "hug mode's box grows with a larger declared size",
    `${shortHeight.toFixed(1)}px -> ${tallHeight.toFixed(1)}px`,
  );

  await typeSizeInput().fill("60");
  await typeSizeInput().blur();
  await settle();
  const shortAgain = (await widget(CLOCK_FIXED_ID).boundingBox()).height;
  check(
    shortAgain < tallHeight,
    "and shrinks back with a smaller one",
    `${tallHeight.toFixed(1)}px -> ${shortAgain.toFixed(1)}px`,
  );

  const overflowing = await widget(CLOCK_FIXED_ID).evaluate((el) => el.dataset.overflowing);
  check(overflowing === "false", "a hugged box never reports overflowing", overflowing);

  // ---- back to fit: read-only again, height a percentage again -----------

  await page.locator("button", { hasText: "Fit to box" }).click();
  await settle();
  check(await typeSizeInput().isDisabled(), "switching back to fit makes the field read-only again");
  check((await heightStyle()).endsWith("%"), "and height goes back to a percentage", await heightStyle());

  console.log("");
} finally {
  await browser.close();
  await stopServer(server);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
