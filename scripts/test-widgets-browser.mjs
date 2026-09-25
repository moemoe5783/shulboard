/**
 * The Gallery's transitions, the QR code and the Text widget, in a real
 * browser (app/(dev)/widgets-lab), through the same BoardRenderer a screen uses.
 *
 *  - GALLERY: at a swap the old photo leaves and the new one arrives with the
 *    chosen effect (the collage's keyframes), both on screen together — nothing
 *    pops — and the old one is gone once the transition is over. `None` swaps
 *    instantly. Speed shortens the animation.
 *  - QR CODE: the rendered code DECODES back to its link, read from a
 *    screenshot the way a phone camera would (jsQR).
 *  - TEXT: a fixed size wraps inside its box at the size set; a Hebrew line
 *    runs right to left; fit fills its box without overflowing; hug grows the
 *    box to the text.
 *
 * Needs a production build; starts its own `next start`.
 * Run with: npm run test:widgets-browser
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import jsQR from "jsqr";
import sharp from "sharp";

const PORT = Number(process.env.PORT ?? 3227);
const BASE = `http://127.0.0.1:${PORT}`;
const GALLERY_ID = "77777777-7777-4777-8777-777777777771";
const QR_ID = "77777777-7777-4777-8777-777777777772";
const TEXT_FIXED_ID = "77777777-7777-4777-8777-777777777773";
const TEXT_FIT_ID = "77777777-7777-4777-8777-777777777774";
const TEXT_HUG_ID = "77777777-7777-4777-8777-777777777775";
const QR_LINK = "https://example.org/donate?campaign=lobby-screen";

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
  console.log("No Chromium found. Set CHROME_PATH to run the widgets browser test.");
  process.exit(0);
}

const child = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
for (let i = 0; i < 60; i += 1) {
  await sleep(500);
  try {
    await fetch(`${BASE}/widgets-lab`);
    break;
  } catch {}
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (error) => check(false, "no page errors", error.message));
  const widget = (id) => page.locator(`[data-widget-id="${id}"]`);

  console.log("\n-- gallery transitions ---------------------------------------");
  const layers = () =>
    widget(GALLERY_ID).evaluate((el) =>
      [...el.querySelectorAll("[data-gallery-layer]")].map((layer) => ({
        role: layer.getAttribute("data-gallery-layer"),
        photo: layer.getAttribute("data-photo-id"),
        animation: getComputedStyle(layer).animationName,
        duration: parseFloat(getComputedStyle(layer).animationDuration) || 0,
      })),
    );
  /** Poll until the gallery is mid-swap (two layers), up to one interval. */
  const catchSwap = async () => {
    for (let i = 0; i < 120; i += 1) {
      const now = await layers();
      if (now.length === 2) return now;
      await sleep(40);
    }
    return layers();
  };

  for (const [transition, leaving, entering] of [
    ["crossfade", "collage-out", "collage-in"],
    ["slide", "collage-slide-out", "collage-slide-in"],
    ["zoom", "collage-zoom-out", "collage-zoom-in"],
  ]) {
    await page.goto(`${BASE}/widgets-lab?transition=${transition}&interval=3`, { waitUntil: "networkidle" });
    const swap = await catchSwap();
    const out = swap.find((l) => l.role === "leaving");
    const inn = swap.find((l) => l.role === "entering");
    check(
      swap.length === 2 && out?.animation === leaving && inn?.animation === entering && out.photo !== inn.photo,
      `${transition}: the old photo leaves and the new one arrives, together`,
      JSON.stringify(swap.map((l) => `${l.role}:${l.photo}:${l.animation}`)),
    );
    // Every effect here is over within about a second at normal speed; the
    // next swap is three seconds away.
    await sleep(1300);
    const after = await layers();
    check(after.length === 1 && after[0].photo === inn?.photo, `${transition}: then only the new photo remains`, `${after.length} layers`);
  }

  {
    await page.goto(`${BASE}/widgets-lab?transition=none&interval=2`, { waitUntil: "networkidle" });
    const seen = new Set();
    let most = 0;
    for (let i = 0; i < 70; i += 1) {
      const now = await layers();
      most = Math.max(most, now.length);
      now.forEach((l) => seen.add(l.photo));
      await sleep(50);
    }
    check(seen.size >= 2 && most === 1, "none: the photo changes instantly, never two at once", `${seen.size} photos seen, at most ${most} layers`);
  }

  {
    await page.goto(`${BASE}/widgets-lab?transition=slide&interval=2&speed=1`, { waitUntil: "networkidle" });
    const normal = (await catchSwap()).find((l) => l.role === "entering")?.duration ?? 0;
    await page.goto(`${BASE}/widgets-lab?transition=slide&interval=2&speed=2`, { waitUntil: "networkidle" });
    const fast = (await catchSwap()).find((l) => l.role === "entering")?.duration ?? 0;
    check(fast > 0 && fast < normal * 0.6, "a faster speed shortens the animation", `${normal}s -> ${fast}s`);
  }

  console.log("\n-- QR code ---------------------------------------------------");
  {
    await page.goto(`${BASE}/widgets-lab`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const svg = widget(QR_ID).locator("svg");
    const shot = await svg.screenshot();
    const { data, info } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    check(decoded?.data === QR_LINK, "the rendered code scans back to its link", decoded?.data ?? "no code found");
    const box = await widget(QR_ID).evaluate((el) => {
      // The drawn code (its light square), not the SVG element, which fills
      // the space above the caption and centres the drawing in it.
      const s = el.querySelector("svg rect").getBoundingClientRect();
      const w = el.getBoundingClientRect();
      const caption = el.querySelector("[data-qr-code] span");
      return { square: Math.abs(s.width - s.height) < 1, inside: s.right <= w.right + 0.5 && s.bottom <= w.bottom + 0.5, caption: caption?.textContent };
    });
    check(box.square && box.inside, "the code stays square inside its box");
    check(box.caption === "Scan to donate", "with its caption underneath", box.caption);
  }

  console.log("\n-- text ------------------------------------------------------");
  {
    const fixed = await widget(TEXT_FIXED_ID).evaluate((el) => {
      const lines = [...el.querySelectorAll("p")];
      const content = lines[0].parentElement;
      return {
        fontPx: parseFloat(getComputedStyle(content).fontSize),
        firstLineHeight: lines[0].getBoundingClientRect().height,
        lineHeightPx: parseFloat(getComputedStyle(lines[0]).lineHeight),
        width: lines[0].getBoundingClientRect().width,
        box: el.getBoundingClientRect().width,
        hebrewDir: getComputedStyle(lines[1]).direction,
      };
    });
    // 40 design units on a 1920 canvas drawn 1280px wide.
    check(Math.abs(fixed.fontPx - 40 * (1280 / 1920)) < 0.5, "fixed text renders at the size set", `${fixed.fontPx.toFixed(1)}px`);
    check(fixed.firstLineHeight > fixed.lineHeightPx * 1.5 && fixed.width <= fixed.box + 0.5, "and wraps inside its box", `${fixed.firstLineHeight.toFixed(0)}px tall`);
    check(fixed.hebrewDir === "rtl", "a Hebrew line runs right to left", fixed.hebrewDir);

    const fit = await widget(TEXT_FIT_ID).evaluate((el) => {
      const content = el.querySelector("p").parentElement;
      const box = content.parentElement;
      return { content: content.scrollHeight, box: box.clientHeight, fontPx: parseFloat(getComputedStyle(content).fontSize) };
    });
    check(fit.content <= fit.box && fit.content > fit.box * 0.6, "fit text fills its box without overflowing", `${fit.content} of ${fit.box}px at ${fit.fontPx.toFixed(0)}px`);

    const hug = await widget(TEXT_HUG_ID).evaluate((el) => ({
      box: el.getBoundingClientRect().height,
      content: el.querySelector("p").parentElement.getBoundingClientRect().height,
    }));
    check(hug.box >= hug.content - 0.5 && hug.box > 60, "hug grows the box to the text", `box ${hug.box.toFixed(0)}px, text ${hug.content.toFixed(0)}px`);
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
