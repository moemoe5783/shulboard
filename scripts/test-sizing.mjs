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
 * properties-panel requirement) — editable in `fixed` and `hug`; in `fit` it
 * is read-only for a widget that also offers Fixed (setting a number there
 * means switching to Fixed), but EDITABLE for a fit-only widget (Title,
 * Zmanim, Candle lighting), where typing a size resizes the box to it. Plus
 * hug's own mechanism: the box's height tracks the declared size instead of
 * the stored percentage, so overflow is structurally impossible rather than
 * something to warn about.
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
  // The properties panel now groups controls into tabs (Options / Appearance /
  // Size); the sizing controls live on the Size tab. The tab is exact-matched so
  // "Size" can't collide with the "Fixed size" button inside the SizingToggle.
  const openSizeTab = async () => {
    await page.getByRole("button", { name: "Size", exact: true }).click();
    await settle();
  };

  // ---- fit-only widget: editable, and typing a size resizes the box ------

  await widget(TITLE_ID).click();
  await settle();
  await openSizeTab();
  check(!(await typeSizeInput().isDisabled()), "a fit-only widget's type size is editable — it drives the box");
  const titleSize = Number(await typeSizeInput().inputValue());
  check(titleSize > 0, "title's type size shows a real computed number, not zero", `${titleSize}`);
  check(
    (await page.locator("span", { hasText: "Sizing" }).count()) === 0,
    "no Sizing toggle appears for a widget with only one mode",
  );

  const beforeTitle = await fontSizeOf(widget(TITLE_ID));
  await typeSizeInput().fill(String(titleSize * 2));
  await typeSizeInput().blur();
  await settle();
  const afterTitle = await fontSizeOf(widget(TITLE_ID));
  check(
    afterTitle > beforeTitle,
    "typing a bigger type size resizes the box, so the fit renders bigger text",
    `${beforeTitle.toFixed(1)}px -> ${afterTitle.toFixed(1)}px`,
  );

  // ---- fixed mode: editable, wired to config.size -------------------------

  await widget(CLOCK_FIXED_ID).click();
  await settle();
  await openSizeTab();
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

  // ---- fixed, too narrow: the clock shrinks to fit rather than clipping ----

  await page.locator("button", { hasText: "Fixed size" }).click();
  await settle();
  await typeSizeInput().fill("400");
  await typeSizeInput().blur();
  await page.waitForTimeout(400);
  const clip = await widget(CLOCK_FIXED_ID).evaluate((el) => {
    const span = el.querySelector("span");
    const box = span.parentElement.getBoundingClientRect();
    const text = span.getBoundingClientRect();
    return { overhang: Math.max(text.right - box.right, box.left - text.left), text: span.textContent };
  });
  check(clip.overhang <= 1, "a fixed clock too wide for its box shrinks to fit instead of being cut off", `${clip.text}: ${clip.overhang.toFixed(1)}px over`);
  check((await typeSizeInput().inputValue()) === "400", "and the declared size stays what was typed");

  // ---- back to fit: read-only again, height a percentage again -----------

  await page.locator("button", { hasText: "Fit to box" }).click();
  await settle();
  check(await typeSizeInput().isDisabled(), "switching back to fit makes the field read-only again");
  check((await heightStyle()).endsWith("%"), "and height goes back to a percentage", await heightStyle());

  console.log("");

  // ---- the Appearance tab, in sections --------------------------------------

  await page.keyboard.press("Escape");
  await widget(TITLE_ID).click();
  await settle();
  await page.getByRole("button", { name: "Options", exact: true }).click();
  await settle();
  check((await page.locator("aside").getByText("Alignment", { exact: true }).count()) === 0,
    "a title's Options no longer mixes in how it looks (alignment moved to Appearance)");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await settle();
  const sectionTabs = await page.locator("[data-appearance-tab]").allTextContents();
  check(sectionTabs.join(",") === "Presets,Background,Shape,Text", "Appearance shows every section's name at the top", sectionTabs.join(", "));
  await page.locator('[data-appearance-tab="text"]').click();
  await settle();
  check((await page.locator('[data-appearance-section="text"]').getByText("Alignment", { exact: true }).count()) === 1 &&
      (await page.locator('[data-appearance-section="text"]').getByText("Font", { exact: true }).count()) === 1,
    "its Text section holds the title's alignment beside the shared font and colour");
  check((await page.locator('[data-appearance-section="text"]').getByText("Header", { exact: true }).count()) === 1,
    "and the header, which is text too");
  await page.locator('[data-appearance-tab="background"]').click();
  await settle();
  check((await page.locator('[data-appearance-section="background"]').getByText("Background", { exact: true }).count()) >= 1,
    "and each section shows only its own controls");
  await page.getByRole("button", { name: "Options", exact: true }).click();
  await settle();

  // ---- zoom -------------------------------------------------------------

  const zoomText = () => page.locator("span.numeric", { hasText: "%" }).first().textContent();
  const zoomNumber = async () => Number((await zoomText()).replace("%", ""));
  const fitted = await zoomNumber();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await settle();
  const zoomedIn = await zoomNumber();
  // The viewport changing size — which scrollbars appearing does — used to
  // snap a zoomed-in board straight back to fit.
  await page.setViewportSize({ width: 1580, height: 950 });
  await sleep(300);
  check(zoomedIn > fitted && (await zoomNumber()) === zoomedIn, "a zoomed-in board stays zoomed when the viewport changes size",
    `${fitted}% -> ${zoomedIn}% -> ${await zoomNumber()}%`);
  const view = await page.locator("[data-editor-viewport]").boundingBox();
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await settle();
  check((await zoomNumber()) > zoomedIn, "Ctrl + scroll zooms in on the board", `${await zoomNumber()}%`);
  await page.keyboard.press("Control+Minus");
  await settle();
  const afterMinus = await zoomNumber();
  await page.keyboard.press("Control+0");
  await settle();
  const refit = await zoomNumber();
  await page.setViewportSize({ width: 1600, height: 950 });
  await sleep(300);
  check(afterMinus < 400 && Math.abs(refit - fitted) <= 2, "Ctrl + − zooms out, and Ctrl + 0 fits the board again", `${afterMinus}% then ${refit}%`);

  // ---- dimensions and preset shapes (lib/editor/size-presets.ts) ----------

  await page.keyboard.press("Escape");
  await widget(TITLE_ID).click();
  await settle();
  const summary = page.locator("[data-size-summary]");
  check(/^\d+ × \d+ px/.test((await summary.textContent()) ?? ""), "clicking an element says how big it is", (await summary.textContent()) ?? "");
  await openSizeTab();
  const presetLine = page.locator("[data-size-preset]");
  await page.locator("[data-dimensions] select").selectOption("letter");
  await settle();
  check(/^Letter flyer, 8\.5 × 11 in, landscape/.test((await presetLine.textContent()) ?? ""),
    "choosing letter makes it a letter flyer shape, keeping which way up it was", (await presetLine.textContent()) ?? "");
  check(/Letter flyer/.test((await summary.textContent()) ?? ""), "and the summary says so", (await summary.textContent()) ?? "");
  await page.getByRole("button", { name: "Portrait" }).click();
  await settle();
  check(/^Letter flyer.*portrait/.test((await presetLine.textContent()) ?? ""), "turning it portrait keeps the shape", (await presetLine.textContent()) ?? "");

  // A corner drag along the diagonal keeps the shape, and says it's still on
  // the preset while dragging.
  const dragHandle = async (name, dx, dy, whileDragging) => {
    const handle = await page.locator(`.moveable-control.moveable-${name}`).first().boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + dx, handle.y + handle.height / 2 + dy, { steps: 16 });
    const during = whileDragging ? await whileDragging() : null;
    await page.mouse.up();
    await settle();
    return during;
  };
  const box = await widget(TITLE_ID).boundingBox();
  const tagText = await dragHandle("se", -box.width * 0.2, -box.height * 0.2, () => page.locator("[data-size-tag]").textContent());
  check(/Letter flyer/.test(tagText ?? ""), "while resizing, a tag shows the size and the shape", tagText ?? "");
  check(/Letter flyer/.test((await presetLine.textContent()) ?? ""), "a corner drag keeps the letter shape", (await presetLine.textContent()) ?? "");
  check(await page.locator("[data-size-tag]").isHidden(), "and the tag goes when the drag ends");

  // An edge drag changes the shape, so it's no longer a preset.
  await dragHandle("e", 60, 0);
  check(/^Not a preset size/.test((await presetLine.textContent()) ?? ""), "an edge drag changes the shape, and it stops being a preset",
    (await presetLine.textContent()) ?? "");

  // Typing a width is a resize too.
  const widthInput = page.locator("[data-dimensions] label", { hasText: "Width" }).locator("input");
  await widthInput.fill("640");
  await widthInput.blur();
  await settle();
  const typed = await page.locator("[data-dimensions] label", { hasText: "Width" }).locator("input").inputValue();
  check(typed === "640" && /^640 ×/.test((await summary.textContent()) ?? ""), "typing a width sets it", (await summary.textContent()) ?? "");

} finally {
  await browser.close();
  await stopServer(server);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
