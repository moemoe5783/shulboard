/**
 * Photo widgets with NO display runtime — the editor's canvas, its previews,
 * a lab — must simply show their photos. /preview-lab renders a Gallery, a
 * Clean and an Artsy Collage, an Image and a photo background through the real
 * BoardRenderer with no files provider, and this checks every one of them
 * draws a loaded picture:
 *
 *   - with the albums on the first render (a lab, a bundle), and
 *   - with the albums arriving after the board mounts, which is how the
 *     editor's live query delivers them — the case that drew empty galleries.
 *
 * The display's own gate — show a page only once its files are on the
 * device — is proved separately by scripts/test-display.mjs (section E).
 *
 * Needs a production build; starts its own `next start`.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3221);
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
  console.log("No Chromium found. Set CHROME_PATH to run the preview photos test.");
  process.exit(0);
}

const child = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
for (let i = 0; i < 60; i += 1) {
  await sleep(500);
  try {
    await fetch(`${BASE}/preview-lab`);
    break;
  } catch {}
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ executablePath });

/** Loaded pictures inside one widget's box, by its widget id. */
const loadedIn = (page, id) =>
  page.evaluate((widgetId) => {
    const frames = [...document.querySelectorAll("[data-preview-board] .absolute.overflow-hidden")];
    // The widget frames are the board's direct children, in document order.
    const board = document.querySelector("[data-preview-board] > div");
    const index = ["gallery", "clean", "artsy", "image"].indexOf(widgetId);
    const frame = board?.children[index];
    void frames;
    return [...(frame?.querySelectorAll("img") ?? [])].filter((img) => img.complete && img.naturalWidth > 0).length;
  }, id);

try {
  for (const mode of ["first render", "late"]) {
    console.log(`\n-- albums ${mode === "late" ? "arriving after the board mounts (the editor)" : "on the first render"} --`);
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on("pageerror", (e) => check(false, "no page errors", e.message));
    await page.goto(`${BASE}/preview-lab${mode === "late" ? "?albums=late" : ""}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    for (const [id, label] of [
      ["gallery", "the gallery"],
      ["clean", "the Clean collage"],
      ["artsy", "the Artsy collage"],
      ["image", "the Image widget"],
    ]) {
      const count = await loadedIn(page, id);
      check(count > 0, `${label} shows its photos`, `${count} loaded`);
    }
    const background = await page.evaluate(() => getComputedStyle(document.querySelector("[data-preview-board] > div")).backgroundImage);
    check(background.includes("data:image/svg+xml"), "the photo background draws", background.slice(0, 40));
    await page.close();
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
