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
const MIXED_TEXT_ID = "77777777-7777-4777-8777-777777777777";
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
  // Then every font theme (lib/fonts/themes.ts): a title in the heading font,
  // the rest in the body font, identical in both halves.
  const THEMES = ["classic-shul", "elegant", "modern", "warm", "simcha", "scholarly"];
  for (const font of ["sefarim", "assistant", ...THEMES.map((t) => `theme:${t}`)]) {
    console.log(`\nTheme: ${font}`);
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on("pageerror", (e) => check(false, "no page errors", e.message));

    const query = font.startsWith("theme:") ? `font=assistant&theme=${font.slice(6)}` : `font=${font}`;
    await page.goto(`${BASE}/font-parity?${query}`, { waitUntil: "networkidle" });
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

    if (font === "sefarim") {
      // Mixed paragraphs under "start": the Hebrew line right, the English
      // lines left, identically in both halves.
      for (const half of ["editor", "display"]) {
        const lines = await page.evaluate(({ half, id }) => {
          const box = document.querySelector(`[data-parity-half="${half}"] [data-widget-id="${id}"]`);
          const block = box?.querySelector("p")?.parentElement;
          if (!block) return null;
          const edges = block.getBoundingClientRect();
          return [...block.querySelectorAll("p")].map((p) => {
            const range = document.createRange();
            range.selectNodeContents(p);
            const ink = range.getBoundingClientRect();
            return { dir: getComputedStyle(p).direction, left: ink.left - edges.left, right: edges.right - ink.right };
          });
        }, { half, id: MIXED_TEXT_ID });
        const ok =
          lines &&
          lines[0].dir === "ltr" && lines[0].left < 2 &&
          lines[1].dir === "rtl" && lines[1].right < 2 && lines[1].left > 10 &&
          lines[2].dir === "ltr" && lines[2].left < 2;
        check(Boolean(ok), `${half}: in a mixed block, the Hebrew paragraph aligns right and the English ones left`, JSON.stringify(lines?.map((l) => [l.dir, Math.round(l.left), Math.round(l.right)])));
      }
    }

    if (font === "theme:simcha") {
      const title = await widgetFont(page, "display", TITLE_ID);
      const clock = await widgetFont(page, "display", CLOCK_FIXED_ID);
      check(/^"DM Serif Display"|^"Suez One Hebrew/.test(title?.fontFamily ?? ""), "Simcha: the title is in the heading font", title?.fontFamily);
      check(/^"?Lato"?,/.test(clock?.fontFamily ?? ""), "and a clock in the body font", clock?.fontFamily);
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

  // Applying a theme in the editor: one click, one undo step, and an element
  // given its own font afterwards keeps it.
  {
    console.log("\nApplying a font theme in the editor");
    const page = await browser.newPage({ viewport: { width: 1600, height: 1800 } });
    page.on("pageerror", (e) => check(false, "no page errors", e.message));
    await page.goto(`${BASE}/font-parity?font=assistant`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const titleFamily = async () => (await widgetFont(page, "editor", TITLE_ID))?.fontFamily ?? "";
    const before = await titleFamily();
    // The board's fonts are a tab of their own, opened from the toolbar with
    // an element still selected.
    await page.locator(`[data-parity-half="editor"] [data-widget-id="${TITLE_ID}"]`).click();
    await page.locator("[data-open-board-fonts]").click();
    await page.waitForSelector("[data-font-theme]");
    check((await page.locator('[data-board-tab="fonts"]').getAttribute("aria-selected")) === "true", "the toolbar's Fonts button opens the board's Fonts tab");
    await page.locator('[data-font-theme="warm"]').click();
    await page.waitForTimeout(300);
    check(/^"Rubik Hebrew[^"]*", "?Outfit"?,/.test(await titleFamily()), "one click on Warm sets the title in Outfit, Rubik for Hebrew", await titleFamily());
    check((await page.locator('[data-font-theme="warm"]').getAttribute("aria-checked")) === "true", "and Warm reads as the chosen theme");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    check((await titleFamily()) === before, "one undo puts the fonts back", await titleFamily());

    // The element font picker: every name in its own font, samples, hover
    // preview on the canvas with no undo entry, then a click that applies.
    const box = await page.locator(`[data-parity-half="editor"] [data-widget-id="${TITLE_ID}"]`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.locator('[data-appearance-tab="text"]').click();
    await page.locator("[data-font-picker] button").first().click();
    await page.waitForSelector("[data-font-list]");
    await page.waitForTimeout(600);
    const rows = await page.evaluate(() => {
      const row = (id) => document.querySelector(`[data-font-list] [data-font-option="${id}"]`);
      const family = (el) => (el ? getComputedStyle(el).fontFamily : "");
      const heights = new Set([...document.querySelectorAll("[data-font-list] [role=option]")].map((el) => el.getBoundingClientRect().height));
      return {
        heebo: family(row("heebo")?.querySelector("[data-font-sample]")),
        heeboHebrew: row("heebo")?.querySelector("[data-font-hebrew-name]")?.textContent ?? "",
        heeboHebrewSample: row("heebo")?.querySelector("[data-font-hebrew-sample]")?.textContent ?? "",
        heeboSample: row("heebo")?.querySelector("[data-font-latin-sample]")?.textContent ?? "",
        heights: [...heights],
      };
    });
    check(/^"?Heebo"?/.test(rows.heebo), "the Heebo row draws its name in Heebo", rows.heebo);
    check(rows.heeboHebrew === "היבו" && rows.heeboHebrewSample !== "" && rows.heeboSample !== "", "a Hebrew & English face shows its Hebrew name and both samples");
    check(rows.heights.length === 1, "every row is one height", rows.heights.join(", "));
    await page.locator("[data-font-list]").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(500);
    const playfair = await page.evaluate(() => {
      const row = document.querySelector('[data-font-list] [data-font-option="playfair-display"]');
      return { hebrew: row?.querySelector("[data-font-hebrew-name], [data-font-hebrew-sample]") !== null, sample: row?.querySelector("[data-font-latin-sample]")?.textContent ?? "" };
    });
    check(!playfair.hebrew && playfair.sample !== "", "an English-only face shows an English sample and no Hebrew");
    const cinzel = await page.evaluate(() => {
      const row = document.querySelector('[data-font-list] [data-font-option="cinzel"]');
      return { note: row?.textContent.includes("capitals only"), transform: getComputedStyle(row?.querySelector("[data-font-latin-sample]")).textTransform };
    });
    check(cinzel.note && cinzel.transform === "uppercase", "a capitals-only face says so and shows its sample in capitals");

    const undoBefore = await page.evaluate(() => document.querySelector("[data-history-count]")?.dataset.historyCount ?? null);
    await page.locator('[data-font-list] [data-font-option="playfair-display"]').hover();
    await page.waitForTimeout(250);
    check(/Playfair Display/.test(await titleFamily()), "hovering Playfair Display shows it on the canvas", await titleFamily());
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    check(!/Playfair Display/.test(await titleFamily()), "moving off the list puts it back", await titleFamily());
    const undoAfter = await page.evaluate(() => document.querySelector("[data-history-count]")?.dataset.historyCount ?? null);
    check(undoBefore === undoAfter, "and hovering left no undo entry", `${undoBefore} -> ${undoAfter}`);
    await page.locator('[data-font-list] [data-font-option="playfair-display"]').click();
    await page.waitForTimeout(250);
    check(/Playfair Display/.test(await titleFamily()), "clicking applies it", await titleFamily());

    const weights = await page.locator("[data-weight-select] option").allTextContents();
    check(weights.join(",") === "Default,Regular,Medium,Semibold,Bold,Extra bold,Black", "the weight list offers Playfair's weights", weights.join(", "));
    await page.locator("[data-weight-select]").selectOption("900");
    await page.waitForTimeout(200);
    check((await widgetFont(page, "editor", TITLE_ID))?.fontWeight === "900", "and a chosen weight draws the title at it");
    await page.close();
  }

  // A zmanim table keeps fitting its box after a frame preset and after being
  // switched to scroll and resized — the grid it measures is the one on screen.
  {
    console.log("\nZmanim after presets and a switch to scroll");
    const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
    page.on("pageerror", (e) => check(false, "no page errors", e.message));
    await page.goto(`${BASE}/font-parity?font=assistant`, { waitUntil: "networkidle" });
    await page.locator("summary", { hasText: "Add element" }).click();
    await page.getByRole("button", { name: /^Zmanim/ }).first().click();
    await page.waitForTimeout(600);
    const zmanim = page.locator('[data-parity-half="editor"] [data-widget-id]').last();
    const at = await zmanim.boundingBox();
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    const read = () =>
      zmanim.evaluate((w) => {
        const grid = w.querySelector(".grid").getBoundingClientRect();
        return { fitted: Number(w.querySelector("[data-fitted-size]").dataset.fittedSize), gridW: grid.width, boxW: w.getBoundingClientRect().width };
      });
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.locator('[data-appearance-tab="presets"]').click();
    await page.locator('button[title="Card"]').click();
    await page.waitForTimeout(400);
    const carded = await read();
    check(carded.fitted > 8 && carded.fitted < 400 && carded.gridW <= carded.boxW + 1, "after a frame preset the table still fits its box", JSON.stringify(carded));
    await page.getByRole("button", { name: "Options", exact: true }).click();
    await page.locator("select").filter({ hasText: "Scroll continuously" }).selectOption("scroll");
    await page.waitForTimeout(400);
    const before = await read();
    const handle = await page.locator(".moveable-control.moveable-se").first().boundingBox();
    await page.mouse.move(handle.x + 3, handle.y + 3);
    await page.mouse.down();
    await page.mouse.move(handle.x + 200, handle.y + 60, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await read();
    check(after.fitted > before.fitted && after.fitted < 400 && after.gridW <= after.boxW + 1,
      "switched to scroll and made wider, the type grows with the box — not to the 400 maximum", `${before.fitted} -> ${after.fitted}`);

    // Line spacing and the header, from Appearance → Text.
    const rowGap = () =>
      zmanim.evaluate((w) => {
        const cells = [...w.querySelector(".grid").children];
        return cells[4].getBoundingClientRect().top - cells[0].getBoundingClientRect().top;
      });
    const tight = await rowGap();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.locator('[data-appearance-tab="text"]').click();
    await page.getByRole("spinbutton", { name: "Line spacing" }).fill("160");
    await page.getByRole("spinbutton", { name: "Line spacing" }).blur();
    await page.waitForTimeout(400);
    const loose = await rowGap();
    const sizeNow = await read();
    check(loose / sizeNow.fitted > (tight / after.fitted) * 1.4, "Line spacing at 160% opens the rows up", `${tight.toFixed(1)}px -> ${loose.toFixed(1)}px a row`);
    await page.locator("input[placeholder='No header']").fill("Zmanim");
    await page.locator("[data-header-align]").selectOption("left");
    await page.getByRole("spinbutton", { name: "Space under the header" }).fill("100");
    await page.getByRole("spinbutton", { name: "Space under the header" }).blur();
    await page.waitForTimeout(300);
    const header = await zmanim.evaluate((w) => {
      const h = [...w.querySelectorAll("div")].find((d) => d.textContent === "Zmanim" && d.children.length === 0);
      const cs = getComputedStyle(h);
      return { align: cs.textAlign, gap: parseFloat(cs.marginBottom), size: parseFloat(cs.fontSize) };
    });
    check(header.align === "left" && Math.abs(header.gap - header.size) < 1, "the header takes its alignment and its space underneath", JSON.stringify(header));
    await page.close();
  }
} finally {
  await browser.close();
  await stopServer(server);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
