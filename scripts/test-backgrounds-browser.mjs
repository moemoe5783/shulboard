/**
 * Board picture backgrounds draw in a real browser — /backgrounds-lab renders
 * them through BoardRenderer. A malformed `background` shorthand doesn't throw
 * anywhere; the browser drops the whole declaration and the board shows its
 * plain ground, so this is the only place that failure is visible. Also: the
 * darkening veil, pictures refused on a widget's box, and every library
 * picture actually loading.
 *
 * Needs a production build; starts its own `next start`.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3218);
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
  console.log("No Chromium found. Set CHROME_PATH to run the backgrounds test.");
  process.exit(0);
}

const child = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
for (let i = 0; i < 60; i += 1) {
  await sleep(500);
  try {
    await fetch(`${BASE}/backgrounds-lab`);
    break;
  } catch {}
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${BASE}/backgrounds-lab`, { waitUntil: "networkidle" });
  const read = () =>
    page.evaluate(() => {
      const out = {};
      for (const sample of document.querySelectorAll("[data-sample]")) {
        const board = sample.firstElementChild;
        const widget = sample.querySelector("[data-widget-id]");
        out[sample.getAttribute("data-sample")] = {
          board: getComputedStyle(board).backgroundImage,
          // The appearance frame is the positioned box's first child
          // (components/board/BoardRenderer.tsx) — that's what carries it.
          widget: widget?.firstElementChild ? getComputedStyle(widget.firstElementChild).backgroundImage : null,
        };
      }
      return out;
    });
  const samples = await read();
  check((samples.photo?.board ?? "").includes("test-card.svg"), "a Media photo draws as the board's background", samples.photo?.board);
  check(
    /linear-gradient/.test(samples["photo-dim"]?.board ?? "") && (samples["photo-dim"]?.board ?? "").includes("test-card.svg"),
    "darkening lays a veil over the photo",
    samples["photo-dim"]?.board,
  );
  check((samples["widget-gradient"]?.widget ?? "none") !== "none", "(control: the probe sees a widget's gradient)", samples["widget-gradient"]?.widget);
  check(samples["widget-picture"]?.widget === "none", "a picture value on a widget's box draws nothing", samples["widget-picture"]?.widget);
  check(samples["legacy-preset"]?.board === "none", "a removed drawn preset falls back to the plain ground", samples["legacy-preset"]?.board);

  const library = Object.entries(samples).filter(([id]) => id.startsWith("library-"));
  const unloaded = await page.evaluate(async () => {
    const bad = [];
    for (const sample of document.querySelectorAll("[data-sample^='library-']")) {
      const match = /url\("?([^")]+)"?\)/.exec(getComputedStyle(sample.firstElementChild).backgroundImage);
      if (!match) {
        bad.push(sample.getAttribute("data-sample"));
        continue;
      }
      const ok = await new Promise((done) => {
        const img = new Image();
        img.onload = () => done(img.naturalWidth > 0);
        img.onerror = () => done(false);
        img.src = match[1];
      });
      if (!ok) bad.push(sample.getAttribute("data-sample"));
    }
    return bad;
  });
  check(unloaded.length === 0, "every library picture loads", `${library.length} in the library${unloaded.length ? `; broken: ${unloaded.join(", ")}` : ""}`);
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
