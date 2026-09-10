/**
 * Font parity between the editor and the display route — CLAUDE.md's shared-
 * renderer rule: "if a widget renders differently in the two places, that's
 * a bug." A previous session's fit/fixed sizing work measured type at the
 * same fraction of board width and called it parity — that proves SIZE,
 * not FAMILY. This checks computed font-family, font-weight and font-style
 * for every text-bearing widget, in both editor sizing modes a widget can be
 * in, against the real BoardEditor chrome and the real DisplayBoard wrapper.
 *
 * Drives app/(dev)/font-parity/page.tsx, which mounts both against the
 * identical document — see that file for why the board's theme is
 * deliberately not Assistant (the same face dashboard chrome opts into): a
 * leaked chrome font and a correctly-inherited board theme that happens to
 * already be Assistant would render identically, hiding exactly the bug
 * this test exists to catch.
 *
 * Run with: npm run test:font-parity
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3214);
const BASE = `http://127.0.0.1:${PORT}`;

const TITLE_ID = "11111111-1111-4111-8111-111111111111";
const CLOCK_FIXED_ID = "22222222-2222-4222-8222-222222222222";
const CLOCK_FIT_ID = "33333333-3333-4333-8333-333333333333";
const HEBREW_DATE_ID = "44444444-4444-4444-8444-444444444444";

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
      await fetch(`${BASE}/font-parity`);
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

/** The first rendered text run inside a widget's box — Title's own span
 *  (ahead of its subtitle span) and Clock's single span are both the first
 *  <span> in their box, so one lookup covers both. */
async function widgetFont(page, half, widgetId) {
  return page.evaluate(
    ({ half, widgetId }) => {
      const root = document.querySelector(`[data-parity-half="${half}"]`);
      const box = root?.querySelector(`[data-widget-id="${widgetId}"]`);
      const span = box?.querySelector("span");
      if (!span) return null;
      const cs = getComputedStyle(span);
      return {
        text: span.textContent,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
      };
    },
    { half, widgetId },
  );
}

/**
 * Does a board face actually HAVE tabular figures?
 *
 * design.md §3 settled this for dashboard chrome by measurement — Assistant
 * ships no tabular figure set, so `font-variant-numeric: tabular-nums` is a
 * measurable no-op on it, while Frank Ruhl Libre responds. CLAUDE.md turns
 * that into a rule with a caveat attached: apply the numeric utility anyway,
 * but never RELY on it to align a column set in Assistant.
 *
 * The board is a different context from chrome — its own font tokens, its
 * own `cqw` sizing, its own next/font faces — so the Zmanim widget's
 * right-aligned column of times is only safe if the same thing is true
 * there. This measures it rather than inheriting the conclusion: `11111`
 * against `00000` in each board face, with and without the property, inside
 * the real board so the real tokens apply.
 */
async function measureNumerals(page, half) {
  return page.evaluate(
    ({ half }) => {
      const root = document.querySelector(`[data-parity-half="${half}"]`);
      const box = root?.querySelector("[data-widget-id]");
      if (!box) return null;

      const width = (family, tabular, text) => {
        const probe = document.createElement("span");
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        probe.style.whiteSpace = "pre";
        probe.style.fontFamily = family;
        probe.style.fontSize = "15px";
        probe.style.fontVariantNumeric = tabular ? "tabular-nums" : "normal";
        probe.textContent = text;
        box.appendChild(probe);
        const measured = probe.getBoundingClientRect().width;
        probe.remove();
        return measured;
      };

      const faces = {};
      for (const [name, family] of [
        ["sefarim", "var(--type-sefarim)"],
        ["ui", "var(--type-ui)"],
      ]) {
        faces[name] = {
          normal: width(family, false, "11111") - width(family, false, "00000"),
          tabular: width(family, true, "11111") - width(family, true, "00000"),
          resolved: getComputedStyle(box).getPropertyValue("--type-sefarim").trim(),
        };
      }
      return faces;
    },
    { half },
  );
}

const executablePath = findChromium();
if (!executablePath) {
  console.log("No Chromium found. Set CHROME_PATH to run the font-parity test.");
  process.exit(0);
}

const { chromium } = await import("playwright-core");
const server = await startServer();
const browser = await chromium.launch({ executablePath });

try {
  // Two themes: the deliberately-non-Assistant default (what actually catches
  // a leak) and Assistant itself (a sanity check that a board choosing the
  // same face as chrome isn't a coincidence this test depends on).
  for (const font of ["sefarim", "assistant"]) {
    console.log(`\nTheme: ${font}`);
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on("pageerror", (e) => check(false, "no page errors", e.message));

    await page.goto(`${BASE}/font-parity?font=${font}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    for (const [label, id] of [
      ["Title (fit, non-toggleable)", TITLE_ID],
      ["Clock (fixed)", CLOCK_FIXED_ID],
      ["Clock (fit)", CLOCK_FIT_ID],
      ["Hebrew date", HEBREW_DATE_ID],
    ]) {
      const editor = await widgetFont(page, "editor", id);
      const display = await widgetFont(page, "display", id);

      if (!editor || !display) {
        check(false, `${label}: both halves render the widget`, JSON.stringify({ editor, display }));
        continue;
      }

      check(
        editor.fontFamily === display.fontFamily,
        `${label}: font-family matches`,
        `editor "${editor.fontFamily}" / display "${display.fontFamily}"`,
      );
      check(
        editor.fontWeight === display.fontWeight,
        `${label}: font-weight matches`,
        `editor ${editor.fontWeight} / display ${display.fontWeight}`,
      );
      check(
        editor.fontStyle === display.fontStyle,
        `${label}: font-style matches`,
        `editor ${editor.fontStyle} / display ${display.fontStyle}`,
      );
    }

    // Once per theme is enough for the parity loop above; the numeral
    // measurement only needs one, and the `sefarim` pass is the one whose
    // board is actually using the face the Zmanim widget's time column
    // sets.
    if (font === "sefarim") {
      const faces = await measureNumerals(page, "display");
      if (!faces) {
        check(false, "numerals: the board rendered something to measure inside");
      } else {
        console.log(
          `  measured spread of "11111" against "00000" at 15px: ` +
            `sefarim ${faces.sefarim.normal.toFixed(2)} -> ${faces.sefarim.tabular.toFixed(2)}, ` +
            `ui ${faces.ui.normal.toFixed(2)} -> ${faces.ui.tabular.toFixed(2)}`,
        );
        // THE ONE THE ZMANIM COLUMN DEPENDS ON. Frank Ruhl Libre has a real
        // tabular set, so `tabular-nums` closes the spread to zero and a
        // right-aligned column of times has a clean edge that does not
        // jitter row to row as the digits change.
        check(
          Math.abs(faces.sefarim.tabular) < 0.05,
          "the board's sefarim face aligns figures under tabular-nums — what the Zmanim time column relies on",
          `${faces.sefarim.normal.toFixed(2)}px -> ${faces.sefarim.tabular.toFixed(2)}px`,
        );
        check(
          Math.abs(faces.sefarim.normal) > 0.5,
          "and the property is doing the work, not the face being monospaced already",
          `${faces.sefarim.normal.toFixed(2)}px without it`,
        );
        // THE CAVEAT, MEASURED HERE TOO. Assistant ships no tabular set, so
        // the property changes nothing on it — which is why a column of
        // times must set the sefarim face rather than relying on the
        // utility class alone. If this ever starts passing, CLAUDE.md's
        // caveat can be dropped; until then it is load-bearing.
        check(
          Math.abs(faces.ui.tabular - faces.ui.normal) < 0.05,
          "while the board's UI face ignores it entirely — CLAUDE.md's caveat, still true on the board",
          `${faces.ui.normal.toFixed(2)}px -> ${faces.ui.tabular.toFixed(2)}px`,
        );
      }
    }

    await page.close();
  }
} finally {
  await browser.close();
  await stopServer(server);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
