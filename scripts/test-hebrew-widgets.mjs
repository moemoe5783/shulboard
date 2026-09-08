/**
 * The five Hebrew-calendar widgets, rendered — a browser-level companion to
 * scripts/test-hebrew.ts's pure computation tests. That suite proves the
 * math; this proves the widgets actually put it on screen: real Hebrew and
 * English text, correct `dir`/`lang` on the Hebrew half, and that toggling a
 * format option in the properties panel actually changes what renders.
 *
 * Drives /editor-lab, which seeds every widget with the real dataflow (the
 * shared tick, the demo location from lib/demo-board.ts) short of a database.
 *
 * NOT covered here: the "no location configured" empty state
 * (widgets/hebrew/EmptyLocation.tsx). editor-lab always has a demo location
 * and there is no UI yet to unset it mid-session; that path is exercised by
 * code review (it is a plain `if (!location)` guard, the same shape as
 * Image's own "no picture" empty state) rather than by an automated render
 * here. Worth a dedicated harness if this empty state ever gets its own bug.
 *
 * Run with: npm run test:hebrew-widgets
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3216);
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/editor-lab`;

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
      await fetch(LAB);
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
  console.log("No Chromium found. Set CHROME_PATH to run the Hebrew widget tests.");
  process.exit(0);
}

const { chromium } = await import("playwright-core");
const server = await startServer();
const browser = await chromium.launch({ executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  page.on("pageerror", (error) => check(false, "no page errors", error.message));

  await page.goto(LAB, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-widget-id]");

  const settle = () => page.waitForTimeout(300);
  const addWidget = async (name) => {
    await page.locator("summary", { hasText: "Add element" }).click();
    await page.waitForTimeout(150);
    await page.locator("details button", { hasText: name }).click();
    await settle();
  };

  const widgetNames = ["Hebrew date", "Parsha", "Daf Yomi", "Candle lighting", "Havdalah"];
  for (const name of widgetNames) await addWidget(name);
  await page.waitForTimeout(1000); // let the first tick land

  // ---- render smoke test, widget by widget --------------------------------

  const boxesText = await page.evaluate(() =>
    [...document.querySelectorAll("[data-widget-id]")].map((el) => el.textContent.trim()),
  );
  // The five just-added widgets are the last five boxes, in the order added.
  const added = boxesText.slice(-5);
  check(added.every((t) => t.length > 0), "every new widget renders non-empty text", added.join(" | "));

  const hebrewSpanAttrs = async (locator) =>
    locator.evaluate((el) => {
      const span = el.querySelector("span[dir]");
      return span ? { dir: span.getAttribute("dir"), lang: span.getAttribute("lang"), text: span.textContent } : null;
    });

  // ---- Hebrew date: RTL attributes on the render editor-lab already has ---

  // The demo board seeds 4 widgets (lib/demo-board.ts); "Hebrew date" was the
  // first of the 5 just added, in DOM/array order, so it's index 4.
  const hebrewDateBox = page.locator("[data-widget-id]").nth(4);
  // Forced: widgets added via the menu all land at the same default
  // position, stacked on top of each other.
  await hebrewDateBox.click({ force: true });
  await settle();
  const attrs = await hebrewSpanAttrs(hebrewDateBox);
  check(attrs?.dir === "rtl" && attrs?.lang === "he", "the Hebrew date's Hebrew line carries dir=rtl lang=he",
    JSON.stringify(attrs));
  check(/[֐-׿]/.test(attrs?.text ?? ""), "and it actually contains Hebrew-block characters",
    attrs?.text ?? "");

  // ---- toggling a format option through the REAL properties panel --------
  //
  // editor-lab has no properties panel at all (it's inline chrome, not
  // components/editor/PropertiesPanel.tsx — see scripts/test-sizing.mjs's
  // own note on this). app/(dev)/font-parity/page.tsx mounts the real
  // BoardEditor and already seeds a Hebrew Date widget for its own font
  // check; reused here for the one thing that actually needs a real panel.

  await page.goto(`${BASE}/font-parity`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-widget-id]");
  await page.waitForTimeout(500);

  const HEBREW_DATE_ID = "44444444-4444-4444-8444-444444444444";
  const editorHalf = () => page.locator('[data-parity-half="editor"]');
  const panelHebrewDate = editorHalf().locator(`[data-widget-id="${HEBREW_DATE_ID}"]`);
  await panelHebrewDate.click();
  await settle();

  const before = await panelHebrewDate.textContent();
  await page.locator("label", { hasText: "Script" }).locator("select").selectOption("transliterated");
  await settle();
  const afterTranslit = await panelHebrewDate.textContent();
  check(
    afterTranslit !== before && !/[֐-׿]/.test(afterTranslit),
    "switching Script to transliterated (via the real properties panel) removes the Hebrew line",
    afterTranslit,
  );

  await page.locator("label", { hasText: "Script" }).locator("select").selectOption("hebrew");
  await settle();
  const afterHebrew = await panelHebrewDate.textContent();
  check(!/[a-zA-Z]/.test(afterHebrew), "switching back to hebrew removes the English line", afterHebrew);

  await page.locator("label", { hasText: "Script" }).locator("select").selectOption("both");
  await settle();

  // Numerals: gematria vs latin should visibly differ.
  const gematriaText = await panelHebrewDate.textContent();
  await page.locator("label", { hasText: "Numerals" }).locator("select").selectOption("latin");
  await settle();
  const latinText = await panelHebrewDate.textContent();
  check(gematriaText !== latinText, "switching numerals to latin changes the rendered date",
    `${gematriaText} -> ${latinText}`);
  check(/\d/.test(latinText), "latin numerals actually show arabic digits", latinText);

  console.log("");
} finally {
  await browser.close();
  await stopServer(server);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
