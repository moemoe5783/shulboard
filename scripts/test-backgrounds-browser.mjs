/**
 * Every background in the library is valid CSS a real browser draws —
 * /backgrounds-lab renders each one. A typo in a gradient or an SVG data URI
 * doesn't throw anywhere; the browser just drops the whole declaration and the
 * board shows plain white, so this is the only place that failure is visible.
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
  const report = await page.evaluate(() =>
    [...document.querySelectorAll("[data-preset]")].map((el) => {
      const cs = getComputedStyle(el);
      return { id: el.getAttribute("data-preset"), declared: el.getAttribute("style") ?? "", image: cs.backgroundImage };
    }),
  );
  const broken = report.filter((r) => !r.image || r.image === "none");
  check(report.length >= 50, "the library renders", `${report.length} backgrounds`);
  check(broken.length === 0, "every background is CSS the browser accepts (none dropped to blank)", broken.map((r) => r.id).join(", "));
  const svgs = report.filter((r) => r.image.includes("data:image/svg+xml"));
  check(svgs.length >= 15, "the patterns, textures and skies draw their SVG layers", `${svgs.length} with SVG`);
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
