/**
 * Display resilience tests — docs/plan.md §3.
 *
 * THE ONE THAT MATTERS: a screen with a cached bundle renders correctly with the
 * network unavailable, and recovers when the network returns. Everything else in
 * §3 is in service of that sentence, and it is not something a unit test can
 * claim — it needs a real service worker, a real IndexedDB, and a real offline
 * transition, which is why this drives Chromium.
 *
 * TWO CONTEXTS, deliberately, because Playwright cannot both run a service
 * worker and intercept the requests a controlled page makes:
 *
 *   A. Service worker ON, no request interception. Tests the cold offline boot —
 *      the shell out of the worker's cache, the bundle out of IndexedDB, the
 *      board on the screen with the network down. This is the acceptance test.
 *   B. Service worker BLOCKED, requests intercepted. Tests the fetch protocol —
 *      ETag, 304, the atomic swap holding a bundle back, 410 retiring a token.
 *
 * Neither half is complete alone and the split is the honest way to get both.
 *
 * Run with: npm run test:display
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { mediaProxyPath } from "../lib/bundle/media.ts";

const PORT = Number(process.env.PORT ?? 3212);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "abcdefghijkmnpqrstuvwxyz23456789";
const DISPLAY = `${BASE}/s/${TOKEN}`;

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
    await fetch(DISPLAY);
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
      await fetch(DISPLAY);
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
      await fetch(DISPLAY);
    } catch {
      return;
    }
    await sleep(250);
  }
}

/** A bundle in the shape the endpoint serves. Built here rather than imported so
 *  the test states the contract instead of inheriting it. */
function bundleFixture({ version, hash, title, assetUrl, assetId = "a1" }) {
  return {
    bundleVersion: version,
    contentHash: hash,
    builtAt: new Date().toISOString(),
    ttlSeconds: 3600,
    screen: {
      id: "5c000000-0000-4000-8000-000000000001",
      name: "Main lobby",
      canvas: { width: 1920, height: 1080 },
      orientation: "landscape",
      timezone: "UTC",
      hebrewPrefs: {},
    },
    theme: { font: "assistant", ink: "ink", background: "surface" },
    playlist: { id: "p1", name: "Weekday", items: [{ boardId: "b1", position: 0, durationSeconds: 30 }] },
    boards: [
      {
        id: "b1",
        name: "Weekday board",
        doc: {
          schemaVersion: 1,
          background: {},
          themeOverrides: {},
          widgets: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              type: "title",
              x: 5, y: 8, w: 60, h: 20, rotation: 0, z: 0,
              locked: false, hidden: false, opacity: 1, groupId: null,
              styleOverrides: {},
              config: { text: title, subtitle: "", align: "left", size: 96, subtitleScale: 0.45 },
            },
            ...(assetUrl
              ? [
                  {
                    id: "33333333-3333-4333-8333-333333333333",
                    type: "image",
                    x: 5, y: 35, w: 40, h: 50, rotation: 0, z: 1,
                    locked: false, hidden: false, opacity: 1, groupId: null,
                    styleOverrides: {},
                    config: {
                      assetId, src: assetUrl, alt: "Kiddush", fit: "cover",
                      focalX: 0.5, focalY: 0.5, radius: 0,
                    },
                  },
                ]
              : []),
          ],
        },
      },
    ],
    content: { announcements: [], schedules: [], people: [], events: [], zmanim: {} },
    assets: assetUrl
      ? [{ id: assetId, url: assetUrl, variant: "display", contentType: "image/svg+xml", bytes: 1024 }]
      : [],
  };
}

/*
 * Real media-proxy paths, not /demo/*. The point of moving off /demo/ is that
 * the thing an offline board caches has to be the thing production actually
 * serves — a bundle never references a static file under /demo/, only
 * /m/<id>/<variant>-<hash>.<ext> (lib/bundle/media.ts). There is no live
 * Supabase project in this environment to back the real route with Storage
 * bytes, so context A still seeds the cache directly rather than fetching —
 * but it seeds it keyed by this exact URL, which is what makes it a test of
 * the real cache-first lookup in public/sw.js instead of a stand-in.
 */
const CACHED_ASSET = { id: "a1", variant: "display", content_hash: "cached-hash-1", extension: "svg" };
const CACHED_ASSET_URL = mediaProxyPath(CACHED_ASSET);

const STEADY_ASSET = { id: "a1", variant: "display", content_hash: "steady-hash", extension: "svg" };
const STEADY_ASSET_URL = mediaProxyPath(STEADY_ASSET);

const HELD_BACK_ASSET = { id: "a2", variant: "display", content_hash: "held-back-hash", extension: "svg" };
const HELD_BACK_ASSET_URL = mediaProxyPath(HELD_BACK_ASSET);

// ---------------------------------------------------------------------------

const executablePath = findChromium();
if (!executablePath) {
  console.log("No Chromium found. Set CHROME_PATH to run the display tests.");
  process.exit(0);
}

const { chromium } = await import("playwright-core");
const server = await startServer();
const browser = await chromium.launch({ executablePath });

/**
 * What the screen actually says.
 *
 * The whole body, not `[data-widget-id]` — that attribute is put on by the
 * EDITOR through BoardRenderer's widgetProps, and the display passes none. A
 * selector that only exists in one of the two halves is exactly the wrong thing
 * to assert the shared renderer with.
 */
const boardText = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
const marker = (page, name) =>
  page.evaluate((n) => document.querySelector(`[data-display-${n}]`)?.dataset?.[
    `display${n[0].toUpperCase()}${n.slice(1).replace(/-(.)/g, (_, c) => c.toUpperCase())}`
  ] ?? null, name);

try {
  // =========================================================================
  // A. The acceptance test: cached bundle, network down.
  // =========================================================================
  console.log("\nA. A screen with a cached bundle, offline");

  const offlineContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await offlineContext.newPage();
  page.on("pageerror", (e) => check(false, "no page errors", e.message));

  // First load, online. The endpoint has no database configured, so it answers
  // 503 — exactly the state a screen is in before its first build lands.
  await page.goto(DISPLAY, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  check(
    (await page.locator("body").innerText()).includes("Waiting for this screen's board"),
    "with nothing cached and nothing served, the screen says so rather than going white",
  );

  // The service worker needs one controlled navigation to cache the shell.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 15000,
  }).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  check(controlled, "the service worker takes control of the display route");

  check(
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.scope.endsWith("/s/") ?? false;
    }),
    "it is scoped to /s/ and never controls the dashboard",
  );

  // Seed last-known-good, the way a screen that had once fetched successfully
  // would hold it.
  await page.evaluate(async (bundle) => {
    const open = indexedDB.open("shulboard", 1);
    await new Promise((resolve, reject) => {
      open.onupgradeneeded = () => open.result.createObjectStore("bundles");
      open.onsuccess = () => resolve();
      open.onerror = () => reject(open.error);
    });
    const db = open.result;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("bundles", "readwrite");
      tx.objectStore("bundles").put(bundle, bundle.__token);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, { ...bundleFixture({ version: 7, hash: "cached-hash", title: "Beis Menachem", assetUrl: CACHED_ASSET_URL }), __token: TOKEN });

  // Warm the asset cache the way the atomic swap does, so the offline board has
  // its picture. Seeded directly with `cache.put` rather than `cache.add` —
  // there is no live Supabase project behind the real /m/ route in this
  // environment to fetch from, so this simulates "a screen that had once
  // fetched successfully," the same stand-in the IndexedDB seed above already
  // is, but keyed by the real proxy URL the service worker's cache-first
  // handler actually looks up.
  await page.evaluate(async (url) => {
    const cache = await caches.open("shulboard-assets-v1");
    await cache.put(
      url,
      new Response("<svg xmlns='http://www.w3.org/2000/svg'/>", {
        headers: { "content-type": "image/svg+xml" },
      }),
    );
  }, CACHED_ASSET_URL);

  // THE CABLE COMES OUT.
  await offlineContext.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1500);

  check(
    (await boardText(page)).includes("Beis Menachem"),
    "offline, from a cold reload, the board renders",
    await boardText(page),
  );
  check(await marker(page, "source") === "cache", "it says it came from this device",
    await marker(page, "source"));
  check(await marker(page, "version") === "7", "it is the cached bundle, not a blank one");

  const imageOk = await page.evaluate(() => {
    const img = document.querySelector("img");
    return Boolean(img && img.complete && img.naturalWidth > 0);
  });
  check(imageOk, "the picture is there too — served from the asset cache with no network");

  // THE CABLE GOES BACK IN.
  await offlineContext.setOffline(false);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  check(
    (await boardText(page)).includes("Beis Menachem"),
    "back online, it still shows the board it had",
  );
  check(
    await page.evaluate(() => navigator.serviceWorker.controller !== null),
    "and the worker is still in control",
  );

  await offlineContext.close();

  // =========================================================================
  // B. The fetch protocol, with the worker out of the way so requests can be
  //    intercepted.
  // =========================================================================
  console.log("\nB. The bundle protocol");

  const netContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    serviceWorkers: "block",
  });
  const net = await netContext.newPage();
  net.on("pageerror", (e) => check(false, "no page errors", e.message));

  let served = bundleFixture({ version: 1, hash: "hash-one", title: "Version one", assetUrl: STEADY_ASSET_URL, assetId: STEADY_ASSET.id });
  let assetAvailable = true;
  const seenIfNoneMatch = [];

  const seenDevice = [];
  await netContext.route("**/api/screen/*/bundle", async (route) => {
    const ifNoneMatch = route.request().headers()["if-none-match"] ?? null;
    seenIfNoneMatch.push(ifNoneMatch);
    seenDevice.push(route.request().headers()["x-screen-device"] ?? null);

    if (served === "gone") {
      await route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ code: "token_invalid" }) });
      return;
    }
    if (ifNoneMatch && ifNoneMatch.replace(/"/g, "") === served.contentHash) {
      await route.fulfill({ status: 304, headers: { etag: `"${served.contentHash}"` } });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { etag: `"${served.contentHash}"` },
      body: JSON.stringify(served),
    });
  });

  // The steady bundle's own asset — real proxy path, mocked here in place of
  // the Storage-backed bytes there is no live project to serve.
  await netContext.route(`**${STEADY_ASSET_URL}`, (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg'/>" }),
  );

  await netContext.route(`**${HELD_BACK_ASSET_URL}`, async (route) => {
    if (assetAvailable) await route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg'/>" });
    else await route.abort("failed");
  });

  await netContext.route("**/api/screen/*/heartbeat", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );

  await net.goto(DISPLAY, { waitUntil: "domcontentloaded" });
  await net.waitForTimeout(1200);

  check((await boardText(net)).includes("Version one"), "a served bundle renders", await boardText(net));
  check(await marker(net, "version") === "1", "at its own version");
  check(await marker(net, "source") === "network", "and says it came from the server");

  // A reload sends the held bundle's ETag, and the server's 304 leaves it alone.
  seenIfNoneMatch.length = 0;
  await net.reload({ waitUntil: "domcontentloaded" });
  await net.waitForTimeout(1200);
  check(
    seenIfNoneMatch.some((value) => value === '"hash-one"'),
    "the next poll sends the held bundle's ETag",
    JSON.stringify(seenIfNoneMatch),
  );
  check((await boardText(net)).includes("Version one"), "a 304 changes nothing");
  check(await marker(net, "source") === "cache", "and it is still rendering from its cached copy");

  // A new bundle whose asset cannot be fetched must NOT swap.
  assetAvailable = false;
  served = bundleFixture({ version: 2, hash: "hash-two", title: "Held back", assetUrl: HELD_BACK_ASSET_URL, assetId: HELD_BACK_ASSET.id });
  await net.evaluate(() => window.dispatchEvent(new Event("shulboard:test-poll")));
  await net.reload({ waitUntil: "domcontentloaded" });
  await net.waitForTimeout(1200);

  check(
    !(await boardText(net)).includes("Held back"),
    "a bundle whose assets will not cache is held back",
    await boardText(net),
  );
  check(
    await marker(net, "waiting-assets") === "true",
    "and the screen says it is waiting for them",
    await marker(net, "waiting-assets"),
  );
  check((await boardText(net)).includes("Version one"), "the old board keeps running meanwhile");

  // The asset comes back; the same bundle now swaps.
  assetAvailable = true;
  await net.reload({ waitUntil: "domcontentloaded" });
  await net.waitForTimeout(1500);
  check((await boardText(net)).includes("Held back"), "once the asset caches, the swap happens",
    await boardText(net));
  check(await marker(net, "version") === "2", "at the new version");

  // Every request proves which TV it is (one TV per screen): the same
  // 43-character device secret each time, kept by the device.
  check(
    seenDevice.length > 0 && seenDevice.every((d) => /^[A-Za-z0-9_-]{43}$/.test(d ?? "") && d === seenDevice[0]),
    "every bundle request carries this device's own secret",
    `${new Set(seenDevice).size} distinct, first ${seenDevice[0]}`,
  );

  // A retired token: the display clears what it stored and goes to show a
  // pairing code (app/pair), so connecting it again needs no typed link.
  await netContext.route("**/api/pair/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Pairing isn't configured yet." }) }),
  );
  served = "gone";
  await net.reload({ waitUntil: "domcontentloaded" });
  await net.waitForURL(/\/pair\?reason=disconnected/, { timeout: 8000 }).catch(() => {});
  check(
    (await net.evaluate(() => localStorage.getItem("shulboard.screen.token"))) === null,
    "a 410 makes the display forget its stored token",
  );
  check(/\/pair\?reason=disconnected/.test(net.url()), "and it goes to show a pairing code rather than going white", net.url());
  check(
    (await net.locator("body").innerText()).includes("disconnected"),
    "saying the TV was disconnected",
  );

  await netContext.close();

  // =========================================================================
  // C. A board with many photos: the screen says how far along it is.
  // =========================================================================
  console.log("\nC. Progress while photos download");
  {
    const manyContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
    const many = await manyContext.newPage();
    many.on("pageerror", (e) => check(false, "no page errors", e.message));
    const photos = (tag, n) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${tag}-${i}`,
        url: `/m/${tag}-${i}/display-${tag}${i}.svg`,
        variant: "display",
        contentType: "image/svg+xml",
        bytes: 200,
      }));
    let current = { ...bundleFixture({ version: 1, hash: "many-one", title: "Sixty photos" }), assets: photos("first", 60) };
    let delay = 250;
    await manyContext.route("**/api/screen/*/bundle", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { etag: `"${current.contentHash}"` }, body: JSON.stringify(current) }),
    );
    await manyContext.route("**/api/screen/*/heartbeat", (route) => route.fulfill({ status: 200, body: "{}" }));
    await manyContext.route("**/api/screen/*/realtime-auth", (route) => route.fulfill({ status: 503, body: "{}" }));
    await manyContext.route("**/m/**", async (route) => {
      await new Promise((r) => setTimeout(r, delay));
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' });
    });

    await many.goto(DISPLAY, { waitUntil: "domcontentloaded" });
    const progress = many.locator("[data-loading-progress]");
    await progress.waitFor({ timeout: 5000 }).catch(() => {});
    const midway = await progress.getAttribute("data-loading-progress").catch(() => null);
    const [done, total] = (midway ?? "0/0").split("/").map(Number);
    check(total === 60 && done < 60, "a first load with many photos shows how far along it is", midway ?? "no progress shown");
    check((await many.locator("body").innerText()).includes("Loading"), "and says it's loading");
    await many.waitForFunction(() => document.querySelector("[data-display-version]")?.getAttribute("data-display-version") === "1", null, { timeout: 15000 }).catch(() => {});
    check((await marker(many, "version")) === "1", "then the board appears");

    // An update with sixty new photos, slow enough to take several seconds.
    current = { ...bundleFixture({ version: 2, hash: "many-two", title: "Sixty more" }), assets: photos("second", 60) };
    delay = 400;
    await many.reload({ waitUntil: "domcontentloaded" });
    const badge = many.locator("[data-updating-badge]");
    await badge.waitFor({ timeout: 8000 }).catch(() => {});
    check(await badge.isVisible().catch(() => false), "a slow update shows a small updating tag", (await badge.textContent().catch(() => "")) ?? "");
    check((await marker(many, "version")) === "1", "while the current board keeps showing");
    await many.waitForFunction(() => document.querySelector("[data-display-version]")?.getAttribute("data-display-version") === "2", null, { timeout: 20000 }).catch(() => {});
    check((await marker(many, "version")) === "2" && !(await badge.isVisible().catch(() => false)), "then the new board swaps in and the tag goes");
    await manyContext.close();
  }
  console.log("");

  // ---- D. A big album: the board goes up before every photo is here --------
  console.log("D. A gallery of many photos starts before they've all downloaded");
  {
    const albumContext = await browser.newContext();
    const page = await albumContext.newPage();
    page.on("pageerror", (e) => check(false, "no page errors", e.message));
    const count = 60;
    const photoList = Array.from({ length: count }, (_, i) => ({
      assetId: `al-${i}`,
      src: `/m/al-${i}/display-al${i}.svg`,
      width: 4,
      height: 4,
      caption: null,
      addedAt: null,
      displayUntil: null,
      variants: [],
    }));
    const base = bundleFixture({ version: 1, hash: "album-one", title: "Kiddush photos" });
    base.boards[0].doc.widgets.push({
      id: "44444444-4444-4444-8444-444444444444",
      type: "gallery",
      x: 50, y: 10, w: 45, h: 80, rotation: 0, z: 2,
      locked: false, hidden: false, opacity: 1, groupId: null,
      styleOverrides: {},
      config: { albumId: "", albumMode: "selected", albumIds: ["al"], excludedAlbumIds: [], intervalSeconds: 2, transition: "none" },
    });
    const bundle = {
      ...base,
      content: { ...base.content, albums: { al: photoList } },
      assets: photoList.map((photo) => ({ id: photo.assetId, url: photo.src, variant: "display", contentType: "image/svg+xml", bytes: 200 })),
    };
    let served = 0;
    await albumContext.route("**/api/screen/*/bundle", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { etag: '"album-one"' }, body: JSON.stringify(bundle) }),
    );
    await albumContext.route("**/api/screen/*/heartbeat", (route) => route.fulfill({ status: 200, body: "{}" }));
    await albumContext.route("**/api/screen/*/realtime-auth", (route) => route.fulfill({ status: 503, body: "{}" }));
    await albumContext.route("**/m/**", async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      served += 1;
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' });
    });

    await page.goto(DISPLAY, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("[data-display-version]")?.getAttribute("data-display-version") === "1", null, { timeout: 15000 }).catch(() => {});
    const servedAtStart = served;
    check((await marker(page, "version")) === "1" && servedAtStart < count / 2, "the board goes up after the first few photos", `${servedAtStart} of ${count} downloaded`);
    const shown = await page.locator("[data-gallery-layer=entering]").getAttribute("data-photo-id").catch(() => null);
    const shownIndex = Number((shown ?? "al-99").slice(3));
    check(shownIndex < 8, "and the gallery shows a photo that's already here", shown ?? "no photo");

    const tag = page.locator("[data-updating-badge]");
    await tag.waitFor({ timeout: 8000 }).catch(() => {});
    const tagText = (await tag.textContent().catch(() => "")) ?? "";
    check(tagText.startsWith("Loading"), "the rest download behind it, with a small loading tag", tagText);

    await page.waitForFunction(() => !document.querySelector("[data-updating-badge]"), null, { timeout: 30000 }).catch(() => {});
    const cachedCount = await page.evaluate(async () => (await (await caches.open("shulboard-assets-v1")).keys()).length);
    check(cachedCount >= count && !(await tag.isVisible().catch(() => false)), "until every photo is on this device and the tag goes", `${cachedCount} cached`);
    await albumContext.close();
  }

  // Many small albums behind one "every album" gallery — how a shul that files
  // each kiddush in its own album actually looks. The head start is per
  // gallery, so this waits for eight photos, not eight from every album.
  {
    const manyAlbums = await browser.newContext();
    const page = await manyAlbums.newPage();
    const albumCount = 30;
    const albums = {};
    const assets = [];
    for (let a = 0; a < albumCount; a += 1) {
      albums[`album-${a}`] = Array.from({ length: 5 }, (_, i) => {
        const src = `/m/ma-${a}-${i}/display-ma${a}x${i}.svg`;
        assets.push({ id: `ma-${a}-${i}`, url: src, variant: "display", contentType: "image/svg+xml", bytes: 200 });
        return { assetId: `ma-${a}-${i}`, src, width: 4, height: 4, caption: null, addedAt: null, displayUntil: null, variants: [] };
      });
    }
    const base = bundleFixture({ version: 1, hash: "albums-many", title: "Every kiddush" });
    base.boards[0].doc.widgets.push({
      id: "55555555-5555-4555-8555-555555555555",
      type: "gallery",
      x: 50, y: 10, w: 45, h: 80, rotation: 0, z: 2,
      locked: false, hidden: false, opacity: 1, groupId: null,
      styleOverrides: {},
      config: { albumId: "", albumMode: "all", albumIds: [], excludedAlbumIds: [], intervalSeconds: 2, transition: "none" },
    });
    const bundle = { ...base, content: { ...base.content, albums }, assets };
    let served = 0;
    await manyAlbums.route("**/api/screen/*/bundle", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { etag: '"albums-many"' }, body: JSON.stringify(bundle) }),
    );
    await manyAlbums.route("**/api/screen/*/heartbeat", (route) => route.fulfill({ status: 200, body: "{}" }));
    await manyAlbums.route("**/api/screen/*/realtime-auth", (route) => route.fulfill({ status: 503, body: "{}" }));
    await manyAlbums.route("**/m/**", async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      served += 1;
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' });
    });
    await page.goto(DISPLAY, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("[data-display-version]")?.getAttribute("data-display-version") === "1", null, { timeout: 15000 }).catch(() => {});
    check((await marker(page, "version")) === "1" && served <= 16, "a gallery of thirty albums waits for a handful of photos, not a few from each album",
      `${served} of ${assets.length} downloaded`);
    await manyAlbums.close();
  }
  console.log("");
} finally {
  await browser.close();
  await stopServer(server);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
