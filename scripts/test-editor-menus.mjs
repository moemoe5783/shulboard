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
 *  5. Right-clicking empty board with nothing selected offers Add element,
 *     and the element lands where the click was.
 *  6. An arrow-key nudge moves the selection frame with the element.
 *  7. Editor notes: a tiny text box shrinks its text rather than sticking on
 *     "overflowing"; a paging zmanim table's note shows for a few seconds
 *     after a resize, and again on hover.
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

  console.log("\n-- right-click empty board to add ------------------------------");
  // A point on the board with no element under it.
  const emptySpot = () =>
    page.evaluate(() => {
      const r = document.querySelector("[data-editor-surface]").getBoundingClientRect();
      for (let fy = 0.15; fy < 0.9; fy += 0.1)
        for (let fx = 0.1; fx < 0.9; fx += 0.1) {
          const x = r.left + r.width * fx;
          const y = r.top + r.height * fy;
          if (y > window.innerHeight - 40) continue;
          if (!document.elementsFromPoint(x, y).some((el) => el instanceof HTMLElement && "widgetId" in el.dataset)) return { x, y };
        }
      return null;
    });
  let spot = null;
  {
    await page.keyboard.press("Escape");
    spot = await emptySpot();
    check(spot !== null, "(set-up: an empty spot on the board)");
    await page.mouse.click(spot.x, spot.y);
    await settle();
    await page.mouse.click(spot.x, spot.y, { button: "right" });
    await settle();
    const addRow = page.locator("[data-context-add]");
    check(await addRow.isVisible(), "nothing selected: the menu offers Add element");
    await addRow.hover();
    await settle();
    const flyout = await page.locator("[data-context-add-menu]").evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    });
    check(inWindow(flyout, 1500, 620), "its list opens beside the menu, inside the window");
    const count = await page.locator("[data-widget-id]").count();
    const idsBefore = await page.evaluate(() => [...document.querySelectorAll("[data-widget-id]")].map((el) => el.dataset.widgetId));
    await page.locator('[data-context-add-widget="title"]').click();
    await settle();
    check((await page.locator("[data-widget-id]").count()) === count + 1, "choosing Title adds one");
    check(!(await page.getByRole("menu").isVisible().catch(() => false)), "and the menu closes");
    const addedId = await page.evaluate(
      (before) => [...document.querySelectorAll("[data-widget-id]")].map((el) => el.dataset.widgetId).find((id) => !before.includes(id)),
      idsBefore,
    );
    const added = await page.evaluate((id) => {
      const selected = [...document.querySelectorAll("aside li button[aria-pressed=true]")].length;
      const b = document.querySelector(`[data-editor-surface] [data-widget-id="${id}"]`).getBoundingClientRect();
      return { selected, cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
    }, addedId);
    check(added.selected === 1, "it's selected");
    check(
      Math.abs(added.cx - spot.x) < 4 && Math.abs(added.cy - spot.y) < 4,
      "and centred where the click was",
      `${added.cx.toFixed(0)},${added.cy.toFixed(0)} vs ${spot.x.toFixed(0)},${spot.y.toFixed(0)}`,
    );

    // Right-clicking an element doesn't offer it: that menu is about the element.
    const addedEl = page.locator(`[data-editor-surface] [data-widget-id="${addedId}"]`);
    const box = await addedEl.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await settle();
    check(!(await page.locator("[data-context-add]").isVisible()), "right-clicking an element: no Add element row");
    await page.keyboard.press("Escape");
    await settle();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await settle();

    console.log("\n-- the selection frame follows an arrow-key nudge --------------");
    const frameGap = () =>
      page.evaluate((id) => {
        const el = document.querySelector(`[data-editor-surface] [data-widget-id="${id}"]`).getBoundingClientRect();
        const handle = document.querySelector(".moveable-control.moveable-nw")?.getBoundingClientRect();
        if (!handle) return null;
        return Math.hypot(handle.left + handle.width / 2 - el.left, handle.top + handle.height / 2 - el.top);
      }, addedId);
    check(((await frameGap()) ?? 99) < 2, "(set-up: the frame sits on the element)");
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("ArrowDown");
    await settle();
    const gap = await frameGap();
    check(gap !== null && gap < 2, "after nudging, the frame is still on the element", `${gap?.toFixed(1)}px off`);
    await page.keyboard.press("Control+z");
    await settle();
    const undone = await frameGap();
    check(undone !== null && undone < 2, "and after an undo too", `${undone?.toFixed(1)}px off`);
  }

  console.log("\n-- editor notes ------------------------------------------------");
  {
    const addAt = async (type) => {
      const before = await page.evaluate(() => [...document.querySelectorAll("[data-widget-id]")].map((el) => el.dataset.widgetId));
      await page.keyboard.press("Escape");
      const at = await emptySpot();
      await page.mouse.click(at.x, at.y);
      await settle();
      await page.mouse.click(at.x, at.y, { button: "right" });
      await settle();
      await page.locator("[data-context-add]").hover();
      await settle();
      await page.locator(`[data-context-add-widget="${type}"]`).click();
      await settle();
      return page.evaluate(
        (ids) => [...document.querySelectorAll("[data-widget-id]")].map((el) => el.dataset.widgetId).find((id) => !ids.includes(id)),
        before,
      );
    };
    // The lab has no properties panel: resize by the corner handle, with
    // ctrl held so snapping doesn't pull it, to a size in design units.
    const setSize = async (id, w, h) => {
      const geo = await page.evaluate((wid) => {
        const surface = document.querySelector("[data-editor-surface]").getBoundingClientRect();
        const el = document.querySelector(`[data-editor-surface] [data-widget-id="${wid}"]`).getBoundingClientRect();
        const se = document.querySelector(".moveable-control.moveable-se").getBoundingClientRect();
        return { zoom: surface.width / 1920, left: el.left, top: el.top, sx: se.left + se.width / 2, sy: se.top + se.height / 2 };
      }, id);
      await page.mouse.move(geo.sx, geo.sy);
      await page.keyboard.down("Control");
      await page.mouse.down();
      await page.mouse.move(geo.left + w * geo.zoom, geo.top + h * geo.zoom, { steps: 10 });
      await page.mouse.up();
      await page.keyboard.up("Control");
      await page.waitForTimeout(600);
    };

    const textId = await addAt("text");
    await setSize(textId, 60, 30);
    const tinyBox = await page.locator(`[data-editor-surface] [data-widget-id="${textId}"]`).evaluate((el) => {
      const zoom = document.querySelector("[data-editor-surface]").getBoundingClientRect().width / 1920;
      const b = el.getBoundingClientRect();
      return { w: b.width / zoom, h: b.height / zoom };
    });
    check(tinyBox.w < 70 && tinyBox.h < 40, "(set-up: the text box is about 60 × 30)", `${tinyBox.w.toFixed(0)} × ${tinyBox.h.toFixed(0)}`);
    const tiny = await page.locator(`[data-editor-surface] [data-widget-id="${textId}"]`).evaluate((el) => el.dataset.overflowing ?? "unset");
    check(tiny !== "true", "a 60 × 30 text box shrinks its text instead of sticking on \"doesn't all fit\"", tiny);
    await setSize(textId, 900, 30);
    const wide = await page.locator(`[data-editor-surface] [data-widget-id="${textId}"]`).evaluate((el) => el.dataset.overflowing ?? "unset");
    check(wide !== "true", "and so does a very wide, very short one", wide);

    const zmanimId = await addAt("zmanim");
    await setSize(zmanimId, 400, 120);
    const zmanim = page.locator(`[data-editor-surface] [data-widget-id="${zmanimId}"]`);
    const noteOpacity = () =>
      zmanim.evaluate((el) => {
        const note = el.querySelector("[data-editor-note]");
        return note ? Number(getComputedStyle(note).opacity) : null;
      });
    const shown = await noteOpacity();
    if (shown === null) {
      check(true, "(no zmanim rows in the lab, so no paging note to check)");
    } else {
      check(shown > 0.9, "a paging zmanim table's note shows right after a resize", `opacity ${shown}`);
      await page.mouse.move(5, 5);
      await page.waitForTimeout(4800);
      check((await noteOpacity()) < 0.1, "and fades after a few seconds", `opacity ${await noteOpacity()}`);
      const zb = await zmanim.boundingBox();
      await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2);
      await page.waitForTimeout(400);
      check((await noteOpacity()) > 0.9, "and comes back on hover", `opacity ${await noteOpacity()}`);
    }
  }

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
