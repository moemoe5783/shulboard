/**
 * The editor's menus and layer picking, in a real browser (/editor-lab):
 *
 *  1. The Add element menu scrolls inside a short window rather than running
 *     off the bottom of the screen.
 *  2. The right-click menu stays inside the window, opened near an edge.
 *  3. A selected widget that another widget covers — picked in the layers
 *     panel — drags when pressed, instead of the widget on top taking the
 *     press. A plain click there still selects the widget on top.
 *  4. Right-clicking a layer row selects it and opens the same menu, whose
 *     commands act on it.
 *
 * Needs a production build; starts its own `next start`.
 * Run with: npm run test:editor-menus
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3230);
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
  console.log("No Chromium found. Set CHROME_PATH to run the editor menus test.");
  process.exit(0);
}

const child = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
for (let i = 0; i < 60; i += 1) {
  await sleep(500);
  try {
    await fetch(`${BASE}/editor-lab`);
    break;
  } catch {}
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 620 } });
  page.on("pageerror", (error) => check(false, "no page errors", error.message));
  await page.goto(`${BASE}/editor-lab`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-widget-id]");
  const settle = () => page.waitForTimeout(200);
  const inWindow = (r, vw, vh) => r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;

  console.log("\n-- the add menu scrolls in a short window ----------------------");
  await page.locator("summary", { hasText: "Add element" }).click();
  await settle();
  const menu = await page.locator("[data-add-menu]").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { scrolls: el.scrollHeight > el.clientHeight + 1, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
  });
  check(menu.scrolls, "a list longer than the window scrolls inside the menu");
  check(inWindow(menu.rect, 1500, 620), "and the menu ends inside the window", `bottom ${menu.rect.bottom.toFixed(0)} of 620`);
  const lastItem = page.locator("[data-add-menu] button").last();
  await lastItem.scrollIntoViewIfNeeded();
  check(await lastItem.isVisible(), "the last element in the list can be reached");

  // Add two elements that land on top of each other in the middle of the board.
  await page.keyboard.press("Escape");
  const add = async (name) => {
    await page.locator("summary", { hasText: "Add element" }).click();
    await settle();
    await page.locator("[data-add-menu] button", { hasText: new RegExp(`^${name}`) }).first().click();
    await settle();
  };
  await add("Text");
  await add("QR code");
  const idOf = (name) =>
    page.evaluate((n) => {
      const rows = [...document.querySelectorAll("aside li")];
      return rows.findIndex((row) => row.textContent?.includes(n));
    }, name);
  const textEl = page.locator("[data-widget-id]", { hasText: "Add your text here." }).first();
  const qrEl = page.locator("[data-widget-id]", { hasText: "Add a link for this QR code." }).first();
  const textId = await textEl.getAttribute("data-widget-id");
  const qrId = await qrEl.getAttribute("data-widget-id");
  const rowButton = (name) => page.locator("aside li", { hasText: name }).first().locator("button").first();
  const pos = (id) => page.locator(`[data-widget-id="${id}"]`).evaluate((el) => ({ left: el.style.left, top: el.style.top }));
  check((await idOf("QR code")) < (await idOf("Add your text")), "(set-up: the QR code is in front of the text)");

  console.log("\n-- a covered, selected widget drags ----------------------------");
  await rowButton("Add your text").click();
  await settle();
  const qrBox = await qrEl.boundingBox();
  const at = { x: qrBox.x + qrBox.width / 2, y: qrBox.y + qrBox.height / 2 };
  const textBefore = await pos(textId);
  const qrBefore = await pos(qrId);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y + 30, { steps: 8 });
  await page.mouse.up();
  await settle();
  const textAfter = await pos(textId);
  const qrAfter = await pos(qrId);
  check(textAfter.left !== textBefore.left && textAfter.top !== textBefore.top, "pressing where the QR code covers it drags the selected text", `${textBefore.left} -> ${textAfter.left}`);
  check(qrAfter.left === qrBefore.left && qrAfter.top === qrBefore.top, "and the QR code on top doesn't move");
  check((await rowButton("Add your text").getAttribute("aria-pressed")) === "true", "and the text stays selected");

  await page.mouse.click(at.x, at.y);
  await settle();
  check((await rowButton("QR code").getAttribute("aria-pressed")) === "true", "a plain click there still selects what's on top");

  console.log("\n-- right-click in the layers panel -----------------------------");
  const before = await page.locator("[data-widget-id]").count();
  const row = page.locator("aside li", { hasText: "Add your text" }).first();
  const rowBox = await row.boundingBox();
  await page.mouse.click(rowBox.x + 20, rowBox.y + rowBox.height / 2, { button: "right" });
  await settle();
  const contextMenu = page.getByRole("menu");
  check(await contextMenu.isVisible(), "right-clicking a layer opens the menu");
  check((await rowButton("Add your text").getAttribute("aria-pressed")) === "true", "and selects that layer");
  await page.getByRole("menuitem", { name: /^Duplicate/ }).click();
  await settle();
  check((await page.locator("[data-widget-id]").count()) === before + 1, "its commands act on it (Duplicate)");

  console.log("\n-- the right-click menu stays in the window --------------------");
  const viewport = await page.locator("[data-editor-viewport]").boundingBox();
  for (const [label, x, y] of [
    ["bottom-right corner", viewport.x + viewport.width - 6, viewport.y + viewport.height - 6],
    ["bottom edge", viewport.x + 80, viewport.y + viewport.height - 6],
    ["top-left", viewport.x + 6, viewport.y + 6],
  ]) {
    await page.mouse.click(x, y, { button: "right" });
    await settle();
    const r = await page.getByRole("menu").evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, scrolls: el.scrollHeight > el.clientHeight + 1 };
    });
    check(inWindow(r, 1500, 620), `opened at the ${label}, it's fully inside the window`, `${r.left.toFixed(0)},${r.top.toFixed(0)} to ${r.right.toFixed(0)},${r.bottom.toFixed(0)}${r.scrolls ? ", scrolls" : ""}`);
    await page.keyboard.press("Escape");
    await settle();
  }

  {
    // A normal-height window, where the whole menu fits: opened near the
    // bottom-right it flips up and to the left of the pointer, whole.
    await page.setViewportSize({ width: 1500, height: 1100 });
    await settle();
    const vp = await page.locator("[data-editor-viewport]").boundingBox();
    const x = vp.x + vp.width - 6;
    const y = vp.y + vp.height - 6;
    await page.mouse.click(x, y, { button: "right" });
    await settle();
    const r = await page.getByRole("menu").evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, scrolls: el.scrollHeight > el.clientHeight + 1 };
    });
    check(
      inWindow(r, 1500, 1100) && !r.scrolls && r.bottom <= y + 1 && r.right <= x + 1,
      "in a taller window it flips up and left from the pointer, whole",
      `${r.left.toFixed(0)},${r.top.toFixed(0)} to ${r.right.toFixed(0)},${r.bottom.toFixed(0)}`,
    );
    await page.keyboard.press("Escape");
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
