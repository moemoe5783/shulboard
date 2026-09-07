/**
 * Realtime bundle-change delivery — docs/plan.md §3d.
 *
 * TWO THINGS THIS PROVES:
 *   1. A broadcast on `screen:<id>` makes an already-open display refetch its
 *      bundle within moments, not on the next 60-second poll.
 *   2. A screen whose socket never actually joins — a silently dead
 *      connection, the real TV failure mode §3d calls out — still gets the
 *      update, because the poll runs unconditionally regardless of
 *      realtime's own state.
 *
 * REQUIRES A DEDICATED BUILD. NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are inlined
 * into the browser bundle at build time (lib/supabase/env.ts), and every
 * other test script in this project runs against a build with neither set —
 * on purpose, so those scripts can prove the "not configured" paths.
 * lib/display/realtime.ts's own subscribeToBundleChanges refuses to even try
 * unless supabaseUrl() resolves to something, so THIS script needs the
 * opposite: a browser that actually attempts the connection. It builds its
 * own copy with fake-but-syntactically-valid values, runs against that, and
 * rebuilds the project back to its normal unconfigured state afterward —
 * leaving `.next/` as `npm test` would leave it, not as whatever this one
 * script needed.
 *
 * NO LIVE SUPABASE PROJECT BACKS THIS. The realtime endpoint is intercepted
 * at the transport level with Playwright's routeWebSocket, replying to
 * exactly the message shape the client sends (`[join_ref, ref, topic, event,
 * payload]`, Phoenix's own wire format) with an `ok` phx_reply, and pushing a
 * hand-built broadcast frame on command. That shape was confirmed
 * empirically against this project's actual installed @supabase/realtime-js
 * — capturing a real client's join frame and replying to it — rather than
 * assumed from reading its source.
 *
 * Run with: npm run test:realtime
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3213);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "abcdefghijkmnpqrstuvwxyz23456789";
const DISPLAY = `${BASE}/s/${TOKEN}`;
const SCREEN_ID = "5c000000-0000-4000-8000-000000000001";

// Syntactically valid per lib/supabase/env.ts's own checks (https, or
// hostname localhost; path "/"; not supabase.com) — never dialed for real,
// since Playwright intercepts the connection before any real socket opens.
const FAKE_SUPABASE_URL = "https://localhost:9999";
const FAKE_SUPABASE_ANON_KEY = "fake-anon-key-for-realtime-test";

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

function build(env) {
  return new Promise((resolve, reject) => {
    rmSync(".next", { recursive: true, force: true });
    const child = spawn("npx", ["next", "build"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`next build exited ${code}\n${output}`)),
    );
  });
}

async function startServer() {
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
    if (exitCode !== null) throw new Error(`the server exited with ${exitCode}\n${output}`);
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

function bundleFixture(version) {
  return {
    bundleVersion: version,
    contentHash: `hash-${version}`,
    builtAt: new Date().toISOString(),
    ttlSeconds: 3600,
    screen: {
      id: SCREEN_ID,
      name: "Main lobby",
      canvas: { width: 1920, height: 1080 },
      orientation: "landscape",
      timezone: "UTC",
      hebrewPrefs: {},
    },
    theme: {},
    playlist: null,
    boards: [],
    content: { announcements: [], schedules: [], people: [], events: [], zmanim: {} },
    assets: [],
  };
}

/** Same marker convention as test-display.mjs — DisplayBoot.tsx's data-display-*
 *  attributes, set regardless of what's on the board. */
const marker = (page, name) =>
  page.evaluate(
    (n) =>
      document.querySelector(`[data-display-${n}]`)?.dataset?.[
        `display${n[0].toUpperCase()}${n.slice(1).replace(/-(.)/g, (_, c) => c.toUpperCase())}`
      ] ?? null,
    name,
  );

/**
 * The minimal Phoenix protocol lib/display/realtime.ts's channel actually
 * speaks: `[join_ref, ref, topic, event, payload]` JSON text frames.
 * `replyToJoin` decides whether phx_join gets acknowledged — false is what
 * makes a channel that connects but never subscribes, standing in for a
 * socket that looks open and says nothing. Every other message carrying a
 * `ref` (a heartbeat, in practice) always gets an `ok` reply regardless, so
 * the connection doesn't look dead for a reason unrelated to what's being
 * tested.
 */
function routePhoenix(context, { replyToJoin, onJoin }) {
  return context.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      if (typeof raw !== "string") return;
      const [joinRef, ref, topic, event] = JSON.parse(raw);
      const isJoin = event === "phx_join";
      if (ref !== null && ref !== undefined && (!isJoin || replyToJoin)) {
        ws.send(JSON.stringify([joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }]));
      }
      if (isJoin && replyToJoin) onJoin?.(ws, topic);
    });
  });
}

function sendBroadcast(ws, topic, payload) {
  ws.send(JSON.stringify([null, null, topic, "broadcast", { type: "broadcast", event: "bundle_changed", payload }]));
}

// ---------------------------------------------------------------------------

const executablePath = findChromium();
if (!executablePath) {
  console.log("No Chromium found. Set CHROME_PATH to run the realtime tests.");
  process.exit(0);
}

console.log("Building with a Realtime-enabled configuration (restored afterward)...");
await build({
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: FAKE_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_SUPABASE_ANON_KEY,
});

const { chromium } = await import("playwright-core");
const server = await startServer();
const browser = await chromium.launch({ executablePath });

try {
  // =========================================================================
  // 1. A broadcast makes an open display refetch immediately.
  // =========================================================================
  console.log("\n1. A broadcast triggers a refetch");

  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (e) => check(false, "no page errors", e.message));

  let fetches = 0;
  await context.route("**/api/screen/*/bundle", (route) => {
    fetches += 1;
    const body = bundleFixture(fetches); // 1 on boot, 2 after the broadcast
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { etag: `"${body.contentHash}"` },
      body: JSON.stringify(body),
    });
  });
  await context.route("**/api/screen/*/realtime-auth", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "fake.jwt.token" }) }),
  );
  await context.route("**/api/screen/*/heartbeat", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );

  let joined = null;
  await routePhoenix(context, {
    replyToJoin: true,
    onJoin: (ws, topic) => {
      joined = { ws, topic };
    },
  });

  await page.goto(DISPLAY, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  check(fetches === 1, "the display fetches its bundle on boot", String(fetches));
  check((await marker(page, "version")) === "1", "and renders it");

  for (let attempt = 0; attempt < 20 && !joined; attempt += 1) await sleep(200);
  check(Boolean(joined), "the display's channel actually joins");

  if (joined) sendBroadcast(joined.ws, joined.topic, { version: 2 });
  await page.waitForTimeout(1000);

  check(fetches === 2, "the broadcast alone triggers a second fetch — no reload, no 60s wait", String(fetches));
  check((await marker(page, "version")) === "2", "and the display renders the new version");

  await context.close();

  // =========================================================================
  // 2. A dead socket — connected but never actually subscribed — doesn't
  //    stop the poll from still updating the screen.
  // =========================================================================
  console.log("\n2. A screen with a dead socket still updates on its poll");

  const deadContext = await browser.newContext({ serviceWorkers: "block" });
  const deadPage = await deadContext.newPage();
  deadPage.on("pageerror", (e) => check(false, "no page errors", e.message));

  let deadFetches = 0;
  await deadContext.route("**/api/screen/*/bundle", (route) => {
    deadFetches += 1;
    const body = bundleFixture(deadFetches);
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { etag: `"${body.contentHash}"` },
      body: JSON.stringify(body),
    });
  });
  await deadContext.route("**/api/screen/*/realtime-auth", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "fake.jwt.token" }) }),
  );
  await deadContext.route("**/api/screen/*/heartbeat", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );

  // The connection opens — a websocket that LOOKS alive — but phx_join is
  // never acknowledged, so the channel never reaches "subscribed" and no
  // broadcast could ever arrive on it.
  await routePhoenix(deadContext, { replyToJoin: false });

  await deadPage.goto(DISPLAY, { waitUntil: "domcontentloaded" });
  await deadPage.waitForTimeout(1200);
  check(deadFetches === 1, "boot still fetches once, regardless of the socket", String(deadFetches));

  // Standing in for the next poll tick the same way this project's other
  // display tests do (test-display.mjs), rather than waiting out POLL_MS for
  // real: a reload re-runs the exact same refresh() the interval calls, and
  // the served bundle has already moved on.
  await deadPage.reload({ waitUntil: "domcontentloaded" });
  await deadPage.waitForTimeout(1200);

  check(deadFetches === 2, "the poll still refetches on its own schedule", String(deadFetches));
  check((await marker(deadPage, "version")) === "2", "and the screen shows the new content, dead socket or not");

  await deadContext.close();
  console.log("");
} finally {
  await browser.close();
  await stopServer(server);
  console.log("Restoring the normal (Supabase-unconfigured) build...");
  await build(process.env);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
