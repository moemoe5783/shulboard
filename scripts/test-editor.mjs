/**
 * Editor interaction tests — docs/plan.md §4b as executable acceptance criteria.
 *
 * Drives a real Chromium against a production build. §4b is a list of gestures,
 * and a gesture is not something you can unit test: the bugs it produces are
 * "the widget follows the cursor after a click", "the snapped edge is a quarter
 * pixel off", "the menu closes before the button is pressed". All three were
 * found here and none of them would have failed a unit test.
 *
 * EVERY COMMAND IS EXERCISED THROUGH THE RIGHT-CLICK MENU, not only through the
 * toolbar. An earlier version of this suite asserted that the menu opened and
 * that it contained the right number of items, which it did — while every item
 * in it did nothing, because the menu dismissed itself on pointerdown before the
 * click could land. Asserting that a control exists is not asserting that it
 * works, and the gap between those two is exactly where that bug lived.
 *
 * Run with: npm run test:editor
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3211);
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = `${BASE}/editor-lab`;

const results = [];
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Find a Chromium.
 *
 * playwright-core deliberately ships no browser. CI images and this dev
 * container both have one already; a laptop may not, and the suite says so and
 * exits clean rather than failing a build over a missing binary.
 */
function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return null;

  for (const entry of readdirSync(root)) {
    if (!entry.startsWith("chromium")) continue;
    for (const candidate of ["chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
      const path = join(root, entry, candidate);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

async function assertPortFree() {
  try {
    await fetch(LAB);
  } catch {
    return;
  }
  throw new Error(`Something is already listening on ${PORT}. Stop it and re-run.`);
}

async function startServer() {
  await assertPortFree();

  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));

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
  await stopServer(child);
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
      await fetch(LAB);
    } catch {
      return;
    }
    await sleep(250);
  }
}

// ---------------------------------------------------------------------------

const executablePath = findChromium();
if (!executablePath) {
  console.log("No Chromium found. Set CHROME_PATH to run the editor tests.");
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

  // ---- helpers ------------------------------------------------------------

  const settle = () => page.waitForTimeout(140);
  const boxes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-widget-id]")].map((el) => ({
        id: el.dataset.widgetId,
        left: el.style.left,
        top: el.style.top,
        width: el.style.width,
        height: el.style.height,
        z: el.style.zIndex,
      })),
    );
  const count = async () => (await boxes()).length;
  const widget = (name) => page.locator("[data-widget-id]", { hasText: name }).first();
  /**
   * The box of the widget whose content starts with this text.
   *
   * Read straight off the located element. An earlier version looked the name
   * up in the layers panel and then indexed into the DOM by that position,
   * which is wrong: the panel is sorted front-to-back and the DOM is in
   * document order, so it silently reported a different widget's numbers.
   */
  const boxOf = (name) =>
    widget(name).evaluate((el) => ({
      id: el.dataset.widgetId,
      left: el.style.left,
      top: el.style.top,
      z: el.style.zIndex,
    }));
  const centreOf = async (name) => {
    const box = await widget(name).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const selectionText = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll("span")]
          .map((s) => s.textContent)
          .find((t) => / selected$/.test(t ?? "")) ?? "?",
    );

  /**
   * Run one command the way a person does: right-click, then press the item.
   *
   * Returns false when the item is present but disabled, so a caller can assert
   * that too — "greyed out when it should be" is part of the contract.
   */
  async function viaMenu(label, at) {
    await page.mouse.click(at.x, at.y, { button: "right" });
    await settle();

    // Prefix, not exact: the accessible name is the label plus its keyboard
    // shortcut. Anchored at the start so "Group" cannot match "Ungroup".
    const item = page.getByRole("menuitem", { name: new RegExp(`^${label}\\b`) });
    if (!(await item.isEnabled())) {
      await page.keyboard.press("Escape");
      await settle();
      return false;
    }

    await item.click();
    await settle();
    return true;
  }

  // ---- the board comes from the registry ----------------------------------

  const seeded = await boxes();
  check(seeded.length === 4, "the demo board renders", `${seeded.length} widgets`);
  check(
    seeded.every((b) => b.left.endsWith("%") && b.width.endsWith("%")),
    "positions are percentages, not pixels",
    `${seeded[0].left} / ${seeded[0].width}`,
  );
  check(
    (await page.locator("summary", { hasText: "Add element" }).count()) === 1,
    "the add menu is built from the registry",
  );
  await page.locator("summary", { hasText: "Add element" }).click();
  await settle();
  const offered = await page.evaluate(() =>
    [...document.querySelectorAll("details button")].map((b) => b.firstChild?.textContent).filter(Boolean),
  );
  check(
    ["Clock", "Image", "Title"].every((name) => offered.includes(name)),
    "every registered widget is offered",
    offered.join(", "),
  );
  await page.keyboard.press("Escape");
  await settle();

  // Live widgets, not placeholders.
  check((await page.locator("[data-widget-id] img").count()) === 1, "the image widget renders an image");
  const clockText = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[data-widget-id]")].find((e) => /\d:\d\d/.test(e.textContent));
    return el?.textContent.trim() ?? "";
  });
  check(/\d{1,2}:\d{2}/.test(clockText), "the clock widget renders a time", clockText);

  // ---- the gestures §4b lists ---------------------------------------------

  {
    const before = await boxOf("Beis Menachem");
    let at = await centreOf("Beis Menachem");
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 150, at.y + 90, { steps: 12 });
    await page.mouse.up();
    await settle();
    const after = await boxOf("Beis Menachem");
    check(after.left !== before.left && after.top !== before.top, "drag moves a widget",
      `${before.left},${before.top} -> ${after.left},${after.top}`);
    check(after.left.endsWith("%"), "a drag commits percentages, not pixels", after.left);

    await page.keyboard.press("Control+z");
    await settle();
    check((await boxOf("Beis Menachem")).left === before.left, "undo takes the drag back");
    await page.keyboard.press("Control+Shift+z");
    await settle();
    check((await boxOf("Beis Menachem")).left === after.left, "redo re-applies it");
    await page.keyboard.press("Control+z");
    await settle();
  }

  {
    const start = await boxOf("Beis Menachem");
    await page.keyboard.press("ArrowRight");
    await settle();
    const one = await boxOf("Beis Menachem");
    check(Math.abs((parseFloat(one.left) - parseFloat(start.left)) * 19.2 - 1) < 0.01,
      "arrow nudges one design unit", `${((parseFloat(one.left) - parseFloat(start.left)) * 19.2).toFixed(3)}`);

    await page.keyboard.press("Shift+ArrowRight");
    await settle();
    const ten = await boxOf("Beis Menachem");
    check(Math.abs((parseFloat(ten.left) - parseFloat(one.left)) * 19.2 - 10) < 0.02,
      "shift+arrow nudges ten", `${((parseFloat(ten.left) - parseFloat(one.left)) * 19.2).toFixed(3)}`);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await settle();
  }

  {
    const before = await boxOf("Beis Menachem");
    const at = await centreOf("Beis Menachem");
    await page.keyboard.down("Shift");
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 170, at.y + 35, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await settle();
    const after = await boxOf("Beis Menachem");
    check(after.top === before.top && after.left !== before.left,
      "shift+drag constrains to one axis", `${before.top} -> ${after.top}`);
    await page.keyboard.press("Control+z");
    await settle();
  }

  {
    const start = await count();
    const at = await centreOf("Beis Menachem");
    await page.mouse.click(at.x, at.y);
    await settle();
    const before = await boxOf("Beis Menachem");
    await page.keyboard.down("Alt");
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 130, at.y - 60, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await settle();
    check((await count()) === start + 1, "alt-drag leaves a copy behind", `${start} -> ${await count()}`);
    const stayed = (await boxes()).filter((b) => b.left === before.left && b.top === before.top);
    check(stayed.length === 1, "the copy sits where the drag began");
    await page.keyboard.press("Control+z");
    await settle();
    check((await count()) === start, "alt-drag is one undo step");
  }

  {
    const at = await centreOf("Shacharis");
    await page.mouse.click(at.x, at.y);
    await settle();
    check((await page.locator(".moveable-control.moveable-direction").count()) === 8,
      "eight resize handles are rendered");
    check((await page.locator(".moveable-control.moveable-rotation-control").count()) === 1,
      "a rotate handle is rendered");

    const before = await widget("Shacharis").evaluate((el) => ({ w: el.style.width, h: el.style.height }));
    const handle = await page.locator(".moveable-control.moveable-se").first().boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 150, handle.y + 100, { steps: 10 });
    await page.mouse.up();
    await settle();
    const after = await widget("Shacharis").evaluate((el) => ({ w: el.style.width, h: el.style.height }));
    check(after.w !== before.w && after.h !== before.h, "resize changes width and height",
      `${before.w}x${before.h} -> ${after.w}x${after.h}`);

    const ratioBefore = parseFloat(after.w) / parseFloat(after.h);
    const next = await page.locator(".moveable-control.moveable-se").first().boundingBox();
    await page.keyboard.down("Shift");
    await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2);
    await page.mouse.down();
    await page.mouse.move(next.x + 170, next.y + 8, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await settle();
    const ratioAfter = await widget("Shacharis").evaluate((el) => parseFloat(el.style.width) / parseFloat(el.style.height));
    check(Math.abs(ratioAfter - ratioBefore) / ratioBefore < 0.05, "shift keeps the aspect ratio",
      `${ratioBefore.toFixed(3)} -> ${ratioAfter.toFixed(3)}`);

    const rotator = await page.locator(".moveable-control.moveable-rotation-control").first().boundingBox();
    await page.mouse.move(rotator.x + rotator.width / 2, rotator.y + rotator.height / 2);
    await page.mouse.down();
    await page.mouse.move(rotator.x + 130, rotator.y + 70, { steps: 12 });
    await page.mouse.up();
    await settle();
    const transform = await widget("Shacharis").evaluate((el) => el.style.transform);
    check(/rotate\((?!0deg)/.test(transform), "rotate writes a rotation", transform);
  }

  // ---- corner-drag proportional resize -------------------------------------
  //
  // A corner drag constrains to the widget's own aspect ratio while the
  // pointer stays near its diagonal, and releases the constraint once it
  // moves well off — Shift forces the constraint regardless of angle, and
  // Image defaults to it regardless of angle too. Every drag below moves in a
  // straight line from the handle, so its angle off the diagonal is the same
  // from the first pixel of movement to the last — there is no ambiguity
  // about which side of the near/far line the gesture is on.
  {
    await page.keyboard.press("Escape");
    await settle();
    const selectAt = await centreOf("Beis Menachem");
    await page.mouse.click(selectAt.x, selectAt.y);
    await settle();

    // Real screen pixels throughout — not the committed CSS percentages, which
    // are relative to the canvas's width and height separately and so are not
    // comparable to each other as a ratio (the canvas itself isn't square).
    const ratioOf = async () => {
      const box = await widget("Beis Menachem").boundingBox();
      return box.width / box.height;
    };

    // Drag close to, but deliberately not exactly on, the widget's own
    // diagonal (dy=75 against an exact match of ~48 at this box's ~6.25:1
    // ratio) with no modifier. Close enough that the constraint should
    // engage — and specifically, that the *result* comes back at the
    // widget's original ratio rather than the input drag's own ~4:1, which
    // is the only way to tell "the constraint engaged" apart from "the drag
    // just happened to land near that ratio anyway".
    {
      const before = await widget("Beis Menachem").boundingBox();
      const ratioBefore = before.width / before.height;
      const handle = await page.locator(".moveable-control.moveable-se").first().boundingBox();
      const dx = 300;
      const dy = 75;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + dx, handle.y + handle.height / 2 + dy, { steps: 16 });
      await page.mouse.up();
      await settle();
      const ratioAfter = await ratioOf();
      check(
        Math.abs(ratioAfter - ratioBefore) / ratioBefore < 0.05,
        "corner drag near the diagonal keeps the aspect ratio",
        `${ratioBefore.toFixed(3)} -> ${ratioAfter.toFixed(3)} (input drag ratio ${(dx / dy).toFixed(3)})`,
      );
      await page.keyboard.press("Control+z");
      await settle();
    }

    // Drag well off that diagonal (45°, far from this widget's own ~9° shape)
    // with no modifier — the constraint should release.
    {
      const before = await widget("Beis Menachem").boundingBox();
      const ratioBefore = before.width / before.height;
      const handle = await page.locator(".moveable-control.moveable-se").first().boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + 220, handle.y + handle.height / 2 + 220, { steps: 16 });
      await page.mouse.up();
      await settle();
      const ratioAfter = await ratioOf();
      check(
        Math.abs(ratioAfter - ratioBefore) / ratioBefore > 0.15,
        "corner drag well off the diagonal releases the aspect ratio",
        `${ratioBefore.toFixed(3)} -> ${ratioAfter.toFixed(3)}`,
      );
      await page.keyboard.press("Control+z");
      await settle();
    }

    // Shift forces the constraint even on that same far-off-diagonal drag.
    {
      const before = await widget("Beis Menachem").boundingBox();
      const ratioBefore = before.width / before.height;
      const handle = await page.locator(".moveable-control.moveable-se").first().boundingBox();
      await page.keyboard.down("Shift");
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + 220, handle.y + handle.height / 2 + 220, { steps: 16 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      await settle();
      const ratioAfter = await ratioOf();
      check(
        Math.abs(ratioAfter - ratioBefore) / ratioBefore < 0.05,
        "shift at a corner forces the constraint even off the diagonal",
        `${ratioBefore.toFixed(3)} -> ${ratioAfter.toFixed(3)}`,
      );
      await page.keyboard.press("Control+z");
      await settle();
    }
  }

  {
    // The Image widget defaults to proportional corner drags — same far-off-
    // diagonal drag as above, no modifier, on the one widget in the demo
    // board whose type is "image".
    const image = page.locator("[data-widget-id]").filter({ has: page.locator("img") }).first();
    await image.click();
    await settle();
    const before = await image.boundingBox();
    const ratioBefore = before.width / before.height;
    const handle = await page.locator(".moveable-control.moveable-se").first().boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 180, handle.y + handle.height / 2 + 20, { steps: 16 });
    await page.mouse.up();
    await settle();
    const after = await image.boundingBox();
    const ratioAfter = after.width / after.height;
    check(
      Math.abs(ratioAfter - ratioBefore) / ratioBefore < 0.05,
      "image corner drags are proportional by default",
      `${ratioBefore.toFixed(3)} -> ${ratioAfter.toFixed(3)}`,
    );
    await page.keyboard.press("Control+z");
    await settle();
  }

  {
    await page.keyboard.press("Escape");
    await settle();
    const target = await widget("Beis Menachem").boundingBox();
    const moving = await widget("Shacharis").boundingBox();
    const dx = target.x - moving.x;

    await page.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2);
    await page.mouse.down();
    await page.mouse.move(moving.x + moving.width / 2 + dx - 4, moving.y + moving.height / 2 + 120, { steps: 14 });
    await page.waitForTimeout(150);

    const guides = await page.locator(".moveable-guideline").count();
    check(guides > 0, "alignment guides appear during a drag", `${guides}`);
    // Every guideline that paints anything, not just the first in the DOM:
    // the library also emits transparent spacer lines, and asserting on
    // whichever came first made this pass or fail on document order.
    const painted = await page.evaluate(() =>
      [...document.querySelectorAll(".moveable-line.moveable-guideline")]
        .map((e) => getComputedStyle(e).backgroundColor)
        .filter((c) => c !== "rgba(0, 0, 0, 0)" && c !== "transparent"),
    );
    check(
      painted.length > 0 && painted.every((c) => c === "rgb(30, 107, 99)"),
      "guides are drawn in verdigris",
      painted.join(", ") || "none painted",
    );
    const thickness = guides
      ? await page.locator(".moveable-guideline.moveable-vertical").first().evaluate((e) => e.getBoundingClientRect().width)
      : 0;
    check(thickness === 1, "guides are 1px", `${thickness}px`);

    await page.keyboard.down("Control");
    await page.mouse.move(moving.x + moving.width / 2 + dx - 5, moving.y + moving.height / 2 + 121, { steps: 3 });
    await page.waitForTimeout(150);
    check((await page.locator(".moveable-guideline").count()) === 0, "ctrl suspends snapping");
    await page.keyboard.up("Control");
    await page.mouse.up();
    await settle();
  }

  {
    // A fresh board, so the command section below starts from the seeded four.
    await page.goto(LAB, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-widget-id]");
    await settle();
    check((await count()) === 4, "the board reloads to its seeded state", `${await count()}`);
  }

  {
    const canvas = await page.locator("[data-widget-id]").first().evaluate((el) => {
      const r = el.parentElement.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.mouse.move(canvas.x + 3, canvas.y + 3);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.w - 3, canvas.y + canvas.h - 3, { steps: 15 });
    check((await page.locator(".selecto-selection").count()) > 0, "marquee draws a selection box");
    await page.mouse.up();
    await settle();
    check(parseInt(await selectionText()) === 4, "marquee selects what it covers", await selectionText());

    await page.keyboard.press("Escape");
    await settle();
    await page.keyboard.press("Control+a");
    await settle();
    check(parseInt(await selectionText()) === 4, "select all takes every widget", await selectionText());
    await page.keyboard.press("Escape");
    await settle();
  }

  // ---- one tick for every clock, and it lets go ---------------------------

  {
    const subscribers = () =>
      page.locator("[data-tick-subscribers]").evaluate((el) => Number(el.dataset.tickSubscribers));

    // The seeded board has one clock; the status bar is the other subscriber.
    await page.waitForTimeout(1100);
    const withOne = await subscribers();
    check(withOne === 2, "one clock and the status row share the tick", `${withOne}`);

    const addClock = async () => {
      await page.locator("summary", { hasText: "Add element" }).click();
      await settle();
      await page.getByRole("button", { name: /^Clock/ }).first().click();
      await page.waitForTimeout(1100);
    };

    await addClock();
    await addClock();
    const withThree = await subscribers();
    check(
      withThree === withOne + 2,
      "each clock adds exactly one subscriber, not one timer",
      `${withOne} -> ${withThree}`,
    );

    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(1100);
    check(
      (await subscribers()) === withOne,
      "removing the clocks releases their subscriptions",
      `back to ${await subscribers()}`,
    );
  }

  // ---- right-click selects what it lands on -------------------------------

  await page.keyboard.press("Escape");
  await settle();
  const title = await centreOf("Beis Menachem");
  await page.mouse.click(title.x, title.y, { button: "right" });
  await settle();
  check((await selectionText()).startsWith("1"), "right-click selects what it lands on", await selectionText());
  await page.keyboard.press("Escape");
  await settle();

  // ---- every command, through the menu ------------------------------------

  {
    const before = await count();
    check(await viaMenu("Duplicate", title), "menu: Duplicate is enabled on a selection");
    check((await count()) === before + 1, "menu: Duplicate adds a widget", `${before} -> ${await count()}`);

    check(await viaMenu("Delete", await centreOf("Beis Menachem")), "menu: Delete is enabled");
    check((await count()) === before, "menu: Delete removes it", `${await count()}`);
  }

  {
    const before = await count();
    check(await viaMenu("Copy", title), "menu: Copy is enabled");
    check(await viaMenu("Paste", title), "menu: Paste is enabled");
    check((await count()) === before + 1, "menu: Copy then Paste adds a widget", `${await count()}`);

    check(await viaMenu("Undo", title), "menu: Undo is enabled after an edit");
    check((await count()) === before, "menu: Undo takes the paste back", `${await count()}`);
    check(await viaMenu("Redo", title), "menu: Redo is enabled after an undo");
    check((await count()) === before + 1, "menu: Redo puts it back", `${await count()}`);
    check(await viaMenu("Cut", await centreOf("Beis Menachem")), "menu: Cut is enabled");
    check((await count()) === before, "menu: Cut removes it", `${await count()}`);
  }

  {
    check(await viaMenu("Send to back", title), "menu: Send to back is enabled");
    check(Number((await boxOf("Beis Menachem")).z) === 0, "menu: Send to back puts it behind everything",
      `z=${(await boxOf("Beis Menachem")).z}`);

    check(await viaMenu("Bring forward", title), "menu: Bring forward is enabled");
    check(Number((await boxOf("Beis Menachem")).z) === 1, "menu: Bring forward steps it up one",
      `z=${(await boxOf("Beis Menachem")).z}`);

    check(await viaMenu("Bring to front", title), "menu: Bring to front is enabled");
    const top = Math.max(...(await boxes()).map((b) => Number(b.z)));
    check(Number((await boxOf("Beis Menachem")).z) === top,
      "menu: Bring to front raises it above everything", `z=${(await boxOf("Beis Menachem")).z} of ${top}`);

    check(await viaMenu("Send backward", title), "menu: Send backward is enabled");
    check(Number((await boxOf("Beis Menachem")).z) === top - 1, "menu: Send backward steps it down one",
      `z=${(await boxOf("Beis Menachem")).z}`);
  }

  {
    // Group needs two, so the menu must refuse it on one.
    check(!(await viaMenu("Group", title)), "menu: Group is refused on a single selection");

    await page.mouse.click(title.x, title.y);
    await settle();
    const clock = await centreOf(":");
    await page.keyboard.down("Shift");
    await page.mouse.click(clock.x, clock.y);
    await page.keyboard.up("Shift");
    await settle();
    check((await selectionText()).startsWith("2"), "two selected before grouping", await selectionText());

    check(await viaMenu("Group", title), "menu: Group is enabled on two");
    check((await page.locator("aside").getByText("grouped").count()) === 2, "menu: Group marks both members");

    check(await viaMenu("Ungroup", title), "menu: Ungroup is enabled inside a group");
    check((await page.locator("aside").getByText("grouped").count()) === 0, "menu: Ungroup clears membership");
  }

  {
    // Clear first. A press inside a multi-selection's frame starts a drag
    // rather than narrowing the selection, so clicking one member of the pair
    // left over from the grouping block would have locked both.
    await page.keyboard.press("Escape");
    await settle();
    await page.mouse.click(title.x, title.y);
    await settle();
    check(await viaMenu("Lock", title), "menu: Lock is enabled");
    check(
      (await page.locator('[data-locked="true"]').count()) === 1,
      "menu: Lock marks the widget unselectable",
      `${await page.locator('[data-locked="true"]').count()} locked`,
    );
    // Unlock through the layers panel, since a locked widget cannot be
    // right-clicked into a selection.
    await page.getByRole("button", { name: /^Unlock / }).first().click();
    await settle();
    check((await page.locator('[data-locked="true"]').count()) === 0, "the widget unlocks again");

    await page.mouse.click(title.x, title.y);
    await settle();
    const visible = await count();
    check(await viaMenu("Hide", title), "menu: Hide is enabled");
    check((await count()) === visible - 1, "menu: Hide takes it off the board", `${await count()}`);
    await page.getByRole("button", { name: /^Show / }).first().click();
    await settle();
    check((await count()) === visible, "the widget comes back");
  }

  {
    // Align and distribute need a multi-selection; the menu must say so.
    await page.keyboard.press("Escape");
    await settle();
    check(!(await viaMenu("Align left", title)), "menu: Align is refused on an empty selection");

    await page.mouse.click(title.x, title.y);
    await settle();
    const other = await centreOf("Shacharis");
    await page.keyboard.down("Shift");
    await page.mouse.click(other.x, other.y);
    await page.keyboard.up("Shift");
    await settle();

    check(await viaMenu("Align top", title), "menu: Align top is enabled on two");
    const titleTop = (await boxOf("Beis Menachem")).top;
    const clockTop = (await boxOf("Shacharis")).top;
    check(titleTop === clockTop, "menu: Align top lines the two tops up", `${titleTop} / ${clockTop}`);

    check(await viaMenu("Align left", title), "menu: Align left is enabled");
    const titleLeft = (await boxOf("Beis Menachem")).left;
    const clockLeft = (await boxOf("Shacharis")).left;
    check(titleLeft === clockLeft, "menu: Align left lines the two lefts up", `${titleLeft} / ${clockLeft}`);

    check((await viaMenu("Space evenly across", title)) === false, "menu: distribute is refused on two");
  }

  console.log("");
} finally {
  await browser.close();
  await stopServer(server);
}

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
