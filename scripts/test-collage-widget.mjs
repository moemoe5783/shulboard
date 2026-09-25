/**
 * The Collage widget in a real browser — /collage-lab/widget, which mounts the
 * real Renderer through BoardRenderer on a synthetic album.
 *
 * What only a browser can answer:
 *   1. Nothing is cropped or stretched ON SCREEN: each image's own aspect ratio
 *      matches the box it renders in.
 *   2. The gaps are uniform in real pixels.
 *   3. The same board at two pixel sizes lays out identically — the editor
 *      (drawn at a zoom) against a screen (drawn at its resolution).
 *   4. Pages advance on the interval, and a page never appears before every
 *      one of its images has loaded.
 *   5. Every photo is shown once per cycle.
 *   6. "Album is empty" shows in the editor and nowhere else.
 *
 * Needs a production build (`npm run build`); starts its own `next start`.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3217);
const BASE = `http://127.0.0.1:${PORT}`;

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
      await fetch(`${BASE}/collage-lab/widget`);
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
}

/** The page currently on screen in one lab board. */
function readBoard(page, board) {
  return page.evaluate((board) => {
    const root = document.querySelector(`[data-lab-board="${board}"] [data-collage]`);
    if (!root) return null;
    const layer = root.querySelector('[data-collage-layer="entering"]');
    const box = root.getBoundingClientRect();
    const cells = layer
      ? [...layer.children].map((cell) => {
          const img = cell.querySelector("img");
          const r = img.getBoundingClientRect();
          return {
            id: cell.getAttribute("data-photo-id"),
            style: cell.getAttribute("style"),
            rect: { x: r.x - box.x, y: r.y - box.y, w: r.width, h: r.height },
            natural: img.naturalWidth / img.naturalHeight,
            complete: img.complete && img.naturalWidth > 0,
          };
        })
      : [];
    return {
      page: root.getAttribute("data-collage-page"),
      cycle: root.getAttribute("data-collage-cycle"),
      layers: root.querySelectorAll("[data-collage-layer]").length,
      cells,
    };
  }, board);
}

const executablePath = findChromium();
if (!executablePath) {
  console.log("No Chromium found. Set CHROME_PATH to run the collage-widget test.");
  process.exit(0);
}

const { chromium } = await import("playwright-core");
const server = await startServer();
const browser = await chromium.launch({ executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/collage-lab/widget?count=20&interval=3&transition=crossfade`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-lab-board="large"] [data-collage-layer="entering"] img');
  await sleep(600);

  console.log("\n-- 1–3: the page on screen ------------------------------------");
  const large = await readBoard(page, "large");
  const small = await readBoard(page, "small");
  check(large && large.cells.length > 1, "the collage shows a page of several photos", `${large?.cells.length} photos`);

  const worstRatio = Math.max(...large.cells.map((c) => Math.abs(c.rect.w / c.rect.h / c.natural - 1)));
  check(worstRatio < 0.01, "every photo renders at its own aspect ratio — not cropped, not stretched", `worst ${(worstRatio * 100).toFixed(2)}% off`);

  {
    // A shadow under each photo sits on the photo's own shape: the <img> box is
    // the picture, not the cell, so its shadow and corners follow it.
    const shadowed = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
    await shadowed.goto(`${BASE}/collage-lab/widget?count=20&interval=60&transition=none&photoFrame=shadow&photoRadius=24&photoShadowStrength=80`, {
      waitUntil: "networkidle",
    });
    await shadowed.waitForSelector('[data-lab-board="large"] [data-collage-layer="entering"] img');
    await sleep(600);
    const photos = await shadowed.evaluate(() => {
      const layer = document.querySelector('[data-lab-board="large"] [data-collage-layer="entering"]');
      const shadows = [...layer.querySelectorAll("[data-photo-shadow]")];
      return [...layer.querySelectorAll("img")].map((img, i) => {
        const r = img.getBoundingClientRect();
        const s = shadows[i]?.getBoundingClientRect();
        return {
          box: r.width / r.height,
          natural: img.naturalWidth / img.naturalHeight,
          // The shadow's box against the photo's, edge by edge, in px.
          offBy: s ? Math.max(Math.abs(s.left - r.left), Math.abs(s.top - r.top), Math.abs(s.width - r.width), Math.abs(s.height - r.height)) : Infinity,
          shadow: shadows[i] ? getComputedStyle(shadows[i]).boxShadow : "none",
          radius: getComputedStyle(img).borderTopLeftRadius,
          // A shadow drawn under every photo, never over one.
          under: shadows[i] ? img.compareDocumentPosition(shadows[i]) & Node.DOCUMENT_POSITION_PRECEDING : 0,
        };
      });
    });
    const worst = Math.max(...photos.map((p) => Math.abs(p.box / p.natural - 1)));
    check(photos.length > 1 && photos.every((p) => p.shadow !== "none"), "Shadow puts a shadow under every photo", photos[0]?.shadow);
    check(worst < 0.01, "each photo's box is the photo's own shape", `worst ${(worst * 100).toFixed(2)}% off`);
    check(photos.every((p) => p.offBy <= 1), "and its shadow is exactly the photo's box", `worst ${Math.max(...photos.map((p) => p.offBy)).toFixed(1)}px`);
    check(photos.every((p) => p.under), "every shadow is drawn before every photo, so none falls across a neighbour");
    check(photos.every((p) => parseFloat(p.radius) > 0), "and its rounded corners are on the photo too", photos[0]?.radius);
    await shadowed.close();
  }

  // gutter 12 design units on a 960px-wide board of a 1920 canvas = 6px.
  const gapPx = 12 * (960 / 1920);
  let closest = Infinity;
  let loneliest = 0;
  for (const a of large.cells) {
    let nearest = Infinity;
    for (const b of large.cells) {
      if (a === b) continue;
      const dx = Math.max(b.rect.x - (a.rect.x + a.rect.w), a.rect.x - (b.rect.x + b.rect.w), 0);
      const dy = Math.max(b.rect.y - (a.rect.y + a.rect.h), a.rect.y - (b.rect.y + b.rect.h), 0);
      const d = Math.hypot(dx, dy);
      closest = Math.min(closest, d);
      nearest = Math.min(nearest, d);
    }
    loneliest = Math.max(loneliest, nearest);
  }
  check(closest >= gapPx - 1 && loneliest <= gapPx + 1, `gaps are ${gapPx}px, uniform to within 1px`, `${closest.toFixed(2)}–${loneliest.toFixed(2)}px`);

  const sameLayout =
    small && small.cells.length === large.cells.length && small.cells.every((c, i) => c.style === large.cells[i].style && c.id === large.cells[i].id);
  check(sameLayout, "the same board at half the pixel size lays out identically (editor zoom vs screen)");

  console.log("\n-- 4–5: cycling ------------------------------------------------");
  const seen = new Map();
  const record = (state) => {
    const key = `${state.cycle}:${state.page}`;
    if (!seen.has(key)) seen.set(key, state.cells.map((c) => c.id));
  };
  record(large);
  let partial = 0;
  let sawTransition = false;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const state = await readBoard(page, "large");
    if (state.layers > 1) sawTransition = true;
    if (state.cells.some((c) => !c.complete)) partial += 1;
    record(state);
    if (Number(state.cycle) >= 2) break;
    await sleep(80);
  }
  const pages = [...seen.entries()];
  check(pages.length >= 2, "pages advance on the interval", `${pages.length} pages seen`);
  check(sawTransition, "and cross-fade (two layers on screen during the swap)");
  check(partial === 0, "no page ever appears with an image still loading", `${partial} samples partial`);

  const firstCycle = pages.filter(([key]) => key.startsWith("1:")).flatMap(([, ids]) => ids);
  check(
    firstCycle.length === 20 && new Set(firstCycle).size === 20,
    "every photo in the album appeared exactly once in the first cycle",
    `${firstCycle.length} shown, ${new Set(firstCycle).size} distinct, across ${pages.filter(([k]) => k.startsWith("1:")).length} pages`,
  );

  console.log("\n-- 5b: several albums, and end dates ----------------------------");
  {
    const shown = new Set();
    const until = Date.now() + 20_000;
    for (;;) {
      const state = await readBoard(page, "multi");
      for (const cell of state.cells) shown.add(cell.id);
      if (Number(state.cycle) >= 2 || Date.now() > until) break;
      await sleep(100);
    }
    const expected = Array.from({ length: 10 }, (_, i) => `lab-${i}`);
    check(
      expected.every((id) => shown.has(id)) && shown.size === 10,
      "two albums merge, a photo in both shows once, and an ended photo is left out",
      `${shown.size} distinct: ${[...shown].sort().join(",")}`,
    );
  }

  console.log("\n-- 6: the empty album ------------------------------------------");
  const visibility = await page.evaluate(() => {
    const read = (board) => {
      const hint = document.querySelector(`[data-lab-board="${board}"] [data-editor-hint]`);
      return hint ? getComputedStyle(hint).visibility : "absent";
    };
    return { display: read("empty-display"), editor: read("empty-editor") };
  });
  check(visibility.editor === "visible", "the editor shows “Album is empty”", visibility.editor);
  check(visibility.display === "hidden", "a screen shows nothing for an empty album", visibility.display);

  for (const transition of ["cascade", "rise", "crossfade"]) {
    console.log(`\n-- 7: the ${transition} transition ------------------------------------`);
    await page.goto(`${BASE}/collage-lab/widget?count=20&interval=3&transition=${transition}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-lab-board="large"] [data-collage-layer="entering"] img');

    // Sample fast through one swap: the leaving page's photos, their animations,
    // and how visible the leaving page still is on the last sample before it's
    // removed. If the old page were removed while still showing, the frame's
    // background would pop into the new page's gaps.
    let swap = null;
    let lastLeavingOpacity = null;
    const end = Date.now() + 15_000;
    while (Date.now() < end) {
      const sample = await page.evaluate(() => {
        const root = document.querySelector('[data-lab-board="large"] [data-collage]');
        const leaving = root.querySelector('[data-collage-layer="leaving"]');
        const entering = root.querySelector('[data-collage-layer="entering"]');
        const cells = (layer) =>
          layer
            ? [...layer.children].map((cell) => {
                const cs = getComputedStyle(cell);
                return {
                  top: parseFloat(cell.style.top),
                  left: parseFloat(cell.style.left),
                  name: cs.animationName,
                  delay: parseFloat(cs.animationDelay) || 0,
                  opacity: parseFloat(cs.opacity),
                };
              })
            : null;
        return { leaving: cells(leaving), entering: cells(entering) };
      });
      if (sample.leaving) {
        swap ??= sample;
        lastLeavingOpacity = Math.max(...sample.leaving.map((c) => c.opacity));
      } else if (swap) {
        break;
      }
      await sleep(30);
    }
    check(swap !== null, `${transition}: a swap happened`);
    if (!swap) continue;
    check(swap.leaving.every((c) => /out/.test(c.name)), `${transition}: the old page animates out, not just covered`, swap.leaving[0]?.name);
    check(lastLeavingOpacity !== null && lastLeavingOpacity < 0.2, `${transition}: the old page is gone before it's removed — nothing pops`, `last seen at ${lastLeavingOpacity?.toFixed(2)} opacity`);
    if (transition !== "crossfade") {
      const byReading = [...swap.entering].sort((a, b) => (Math.abs(a.top - b.top) > 2 ? a.top - b.top : a.left - b.left));
      const increasing = byReading.every((c, i) => i === 0 || c.delay > byReading[i - 1].delay);
      const leavingFirst = Math.min(...swap.entering.map((c) => c.delay)) > 0;
      check(increasing, `${transition}: new photos arrive one after another, in reading order`, byReading.map((c) => c.delay.toFixed(2)).join(" "));
      check(leavingFirst, `${transition}: and only once the old ones have started to go`);
    }
  }

  console.log("\n-- 7b: photo order and speed ------------------------------------");
  {
    /** The entering page's per-photo delays (seconds) at the first swap. */
    const delaysAt = async (query) => {
      await page.goto(`${BASE}/collage-lab/widget?count=20&interval=3&${query}`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-lab-board="large"] [data-collage-layer="entering"] img');
      const end = Date.now() + 15_000;
      while (Date.now() < end) {
        const cells = await page.evaluate(() => {
          const root = document.querySelector('[data-lab-board="large"] [data-collage]');
          if (!root.querySelector('[data-collage-layer="leaving"]')) return null;
          return [...root.querySelector('[data-collage-layer="entering"]').children].map((cell) => ({
            top: parseFloat(cell.style.top),
            left: parseFloat(cell.style.left),
            delay: parseFloat(getComputedStyle(cell).animationDelay) || 0,
          }));
        });
        if (cells) return cells;
        await sleep(30);
      }
      return null;
    };
    const reading = (cells) => [...cells].sort((a, b) => (Math.abs(a.top - b.top) > 2 ? a.top - b.top : a.left - b.left));
    const increasing = (list) => list.every((c, i) => i === 0 || c.delay > list[i - 1].delay);

    const random = await delaysAt("transition=cascade&order=random");
    check(
      random && new Set(random.map((c) => c.delay.toFixed(3))).size === random.length && !increasing(reading(random)),
      "random order: every photo gets its own turn, but not top to bottom",
      random ? reading(random).map((c) => c.delay.toFixed(2)).join(" ") : "no swap",
    );

    const normal = await delaysAt("transition=cascade&order=reading&speed=1");
    const fast = await delaysAt("transition=cascade&order=reading&speed=2");
    const last = (cells) => Math.max(...cells.map((c) => c.delay));
    const ratio = normal && fast ? last(fast) / last(normal) : null;
    check(ratio !== null && Math.abs(ratio - 0.5) < 0.08, "speed 2× runs the same sequence in half the time", ratio === null ? "no swap" : `${ratio.toFixed(2)}× the delay`);
  }

  console.log("\n-- 8: the editor with collages saved by an older version ----------");
  {
    const editorErrors = [];
    const onError = (e) => editorErrors.push(e.message);
    page.on("pageerror", onError);
    await page.goto(`${BASE}/collage-lab/legacy-editor`, { waitUntil: "networkidle" });
    await sleep(1500);
    const loaded = await page.locator("[data-widget-id]").count();
    const failed = await page.getByText("This page didn’t load").or(page.getByText("This page didn't load")).count();
    page.off("pageerror", onError);
    check(failed === 0 && loaded === 2, "the editor opens a board holding a pre-multi-album collage and gallery", `${loaded} widgets, ${failed ? "error page" : "no error page"} ${editorErrors.join(" | ")}`);
  }

  console.log("\n-- 9: the Artsy style ------------------------------------------");
  // What the rendered prints look like to the browser: each photo's own
  // (unrotated) box against its natural shape, whether anything else is on top
  // of any point in it, and whether every print stays in the collage's box.
  const readArtsy = (board) =>
    page.evaluate((board) => {
      const root = document.querySelector(`[data-lab-board="${board}"] [data-collage]`);
      if (!root) return null;
      const box = root.getBoundingClientRect();
      const layer = root.querySelector('[data-collage-layer="entering"]');
      const prints = layer ? [...layer.querySelectorAll("[data-artsy-print]")] : [];
      let covered = 0;
      let outside = 0;
      let worstRatio = 0;
      for (const print of prints) {
        const img = print.querySelector("img");
        const rotor = img.parentElement;
        const r = rotor.getBoundingClientRect();
        if (r.left < box.left - 1 || r.top < box.top - 1 || r.right > box.right + 1 || r.bottom > box.bottom + 1) outside += 1;
        worstRatio = Math.max(worstRatio, Math.abs(img.offsetWidth / img.offsetHeight / (img.naturalWidth / img.naturalHeight) - 1));
        // Points across the image, in its own tilted frame.
        const m = /rotate\((-?[\d.]+)deg\)/.exec(rotor.style.transform ?? "");
        const angle = m ? (Number(m[1]) * Math.PI) / 180 : 0;
        const ir = img.getBoundingClientRect();
        const cx = ir.left + ir.width / 2;
        const cy = ir.top + ir.height / 2;
        const w = img.offsetWidth * (box.width / root.offsetWidth);
        const h = img.offsetHeight * (box.height / root.offsetHeight);
        for (const [fx, fy] of [[0, 0], [-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46], [0, -0.48], [0, 0.48], [-0.48, 0], [0.48, 0]]) {
          const lx = fx * w;
          const ly = fy * h;
          const x = cx + lx * Math.cos(angle) - ly * Math.sin(angle);
          const y = cy + lx * Math.sin(angle) + ly * Math.cos(angle);
          if (document.elementFromPoint(x, y) !== img) covered += 1;
        }
      }
      return {
        count: prints.length,
        covered,
        outside,
        worstRatio,
        tilted: prints.filter((p) => /rotate/.test(p.firstElementChild.style.transform ?? "")).length,
        tape: layer ? layer.querySelectorAll('[data-fastener="tape"]').length : 0,
        layout: prints.map((p) => `${p.dataset.photoId}@${p.style.left},${p.style.top},${p.firstElementChild.style.transform}`),
      };
    }, board);

  for (const [label, query] of [
    ["Polaroids on cork, playful", "artsyFrame=polaroid&artsyBackdrop=cork&artsyTilt=playful"],
    ["taped snapshots", "artsyFrame=taped&artsyTilt=subtle"],
    ["mixed prints", "artsyFrame=mixed&artsyTilt=playful&artsyOverlap=slight"],
    ["a wood-frame gallery wall", "artsyFrame=wood&artsyTilt=none&artsyOverlap=none"],
  ]) {
    await page.goto(`${BASE}/collage-lab/widget?count=20&interval=60&transition=none&style=artsy&${query}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-lab-board="large"] [data-artsy-print] img');
    await sleep(500);
    const large = await readArtsy("large");
    const small = await readArtsy("small");
    check(large.count > 1 && large.covered === 0, `${label}: nothing covers any part of any photo`, `${large.count} prints, ${large.covered} covered points`);
    check(large.outside === 0 && large.worstRatio < 0.01, `${label}: every print inside the box, every photo its own shape`,
      `${large.outside} outside, worst ${(large.worstRatio * 100).toFixed(2)}% off`);
    check(small.layout.join("|") === large.layout.join("|"), `${label}: the same layout at half the size`);
    if (label.startsWith("taped")) check(large.tape > 0, "taped snapshots carry their tape", `${large.tape} strips`);
    if (label.includes("playful")) check(large.tilted >= large.count - 2, `${label}: tilted`, `${large.tilted} of ${large.count}`);
  }

  // Deal: the next page's prints drop in one after another, bottom first.
  await page.goto(`${BASE}/collage-lab/widget?count=20&interval=3&transition=deal&style=artsy&artsyFrame=polaroid`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-lab-board="large"] [data-artsy-print] img');
  {
    let dealt = null;
    const until = Date.now() + 12_000;
    while (Date.now() < until && !dealt) {
      dealt = await page.evaluate(() => {
        const layer = document.querySelector('[data-lab-board="large"] [data-collage-layer="entering"]');
        const leaving = document.querySelector('[data-lab-board="large"] [data-collage-layer="leaving"]');
        if (!layer || !leaving) return null;
        const animations = [...layer.querySelectorAll("[data-artsy-print]")].map((p) => {
          const style = getComputedStyle(p);
          return { name: style.animationName, delay: parseFloat(style.animationDelay) };
        });
        return animations.length ? animations : null;
      });
      if (!dealt) await sleep(60);
    }
    const delays = (dealt ?? []).map((a) => a.delay).sort((a, b) => a - b);
    check(Boolean(dealt) && dealt.every((a) => a.name === "collage-deal-in") && new Set(delays).size === delays.length,
      "Deal drops the new prints in one after another", delays.join(", "));
  }

  check(errors.length === 0, "no page errors", errors.join(" | "));
} finally {
  await browser.close();
  await stopServer(server);
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
