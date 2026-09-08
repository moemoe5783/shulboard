/**
 * The five Hebrew-calendar widgets, rendered — a browser-level companion to
 * scripts/test-hebrew.ts's pure computation tests. That suite proves the
 * math; this proves the widgets actually put it on screen: real Hebrew and
 * English text, correct `dir`/`lang` on the Hebrew half, and that toggling a
 * format option in the properties panel actually changes what renders —
 * including, for Havdalah, that picking a different shitah in the real
 * panel changes the actual rendered clock time to the value already
 * verified by hand against a published source (scripts/test-hebrew.ts's own
 * Havdalah section documents which).
 *
 * Drives /editor-lab, which seeds every widget with the real dataflow (the
 * shared tick, the demo location from lib/demo-board.ts) short of a database.
 * The page's clock is frozen (Playwright's `page.clock`) to the exact
 * Friday/location scripts/test-hebrew.ts's own Havdalah table was verified
 * against, before anything on the page has a chance to read the real
 * `Date.now()` — lib/tick.ts's tick starts from whatever `Date.now()` reads
 * the moment its module first evaluates, so the freeze has to be in place
 * before that first navigation, not applied to it afterwards.
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

  // Same Friday scripts/test-hebrew.ts's FRIDAY_NOON uses (25 Tamuz 5786,
  // Crown Heights) — frozen before the first navigation so lib/tick.ts's
  // module-load-time `Date.now()` read, and every widget's Hebrew date/
  // Havdalah computation after it, land on the exact date that suite's own
  // hand-verified values apply to.
  await page.clock.setFixedTime(new Date("2026-07-10T16:00:00.000Z"));

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

  // ---- Havdalah: shitah override, driven through the REAL properties panel
  //
  // widgets/havdalah's config carries "transliterated" here (see
  // font-parity's own comment on HAVDALAH_ID), so the widget's whole
  // textContent is plain ASCII and a clock-time regex is all reading the
  // rendered time back needs — no Hebrew line to skip over.

  const HAVDALAH_ID = "66666666-6666-4666-8666-666666666666";
  const panelHavdalah = editorHalf().locator(`[data-widget-id="${HAVDALAH_ID}"]`);
  await panelHavdalah.click();
  await settle();

  const renderedTime = async () => {
    const text = (await panelHavdalah.textContent()) ?? "";
    return text.match(/\d{1,2}:\d{2}\s?[AP]M/)?.[0] ?? null;
  };
  const shitahSelect = () => page.locator("label", { hasText: "Shitah" }).locator("select");
  const minutesField = () => page.locator("label", { hasText: "Minutes after sunset" }).locator("input");

  // The table scripts/test-hebrew.ts's own Havdalah section already
  // verified by hand against hebcal.com for this exact Friday and location
  // (Crown Heights, lib/demo-board.ts's DEMO_LOCATION) — reused here rather
  // than re-derived, since the point of this test is that the real panel
  // reaches the real computation, not a second check of the computation
  // itself.
  const SHITAH_TIMES = {
    tzeis_3_stars: "9:17 PM",
    tzeis_medium_stars: "9:07 PM",
    tzeis_72: "9:40 PM",
  };

  for (const [shitah, expected] of Object.entries(SHITAH_TIMES)) {
    await shitahSelect().selectOption(shitah);
    await settle();
    check((await renderedTime()) === expected, `shitah "${shitah}" renders ${expected}`, await renderedTime());
    check(await minutesField().isDisabled(), `minutes field is disabled for shitah "${shitah}"`);
  }

  // Custom: the field enables, its own default (50) renders a distinct
  // time, and editing it changes the render again — to exactly what
  // "tzeis_72" rendered above, since 72 fixed minutes is 72 fixed minutes
  // regardless of which option asked for it.
  await shitahSelect().selectOption("custom");
  await settle();
  check(!(await minutesField().isDisabled()), "minutes field enables for shitah \"custom\"");
  check((await renderedTime()) === "9:18 PM", "custom defaults to 50 minutes, matching the hand-verified table",
    await renderedTime());

  await minutesField().fill("72");
  await settle();
  check((await renderedTime()) === SHITAH_TIMES.tzeis_72,
    "custom at 72 minutes renders the same time as shitah \"tzeis_72\"", await renderedTime());

  console.log("");
} finally {
  await browser.close();
  await stopServer(server);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
