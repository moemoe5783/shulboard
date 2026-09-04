/**
 * Route protection tests.
 *
 * A signed-out visitor must not reach anything under app/(app), and the display
 * route must stay reachable without a session — a TV in a lobby has no cookies
 * and never will.
 *
 * Runs against a production build with no valid session, which is exactly the
 * signed-out case. Run with: npm run test:routes
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;

// Syntactically valid, points at nothing. The middleware never reaches the
// network for a request with no session cookie, so nothing here is contacted.
const DUMMY_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy-anon-key-for-route-tests",
};

const results = [];
function check(ok, label, detail = "") {
  results.push({ ok, label, detail });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function startServer(env) {
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, ...env },
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(500);
    try {
      await fetch(`${BASE}/sign-in`, { redirect: "manual" });
      return child;
    } catch {
      // not up yet
    }
  }
  child.kill("SIGKILL");
  throw new Error("next start never came up");
}

async function run(label, env) {
  console.log(`\n${label}`);
  const server = await startServer(env);

  try {
    // Protected: everything under app/(app).
    for (const path of ["/", "/orgs/new"]) {
      const res = await fetch(BASE + path, { redirect: "manual" });
      const location = res.headers.get("location") ?? "";
      const redirected = res.status >= 300 && res.status < 400;
      check(
        redirected && new URL(location, BASE).pathname === "/sign-in",
        `signed out: ${path} is turned away`,
        `${res.status} ${location}`,
      );
    }

    // Public: the display route has no session and must never be asked for one.
    const display = await fetch(`${BASE}/s/abcdefghijklmnopqrstuvwxyz012345`, {
      redirect: "manual",
    });
    check(display.status === 200, "signed out: /s/[token] stays public", `${display.status}`);

    const signIn = await fetch(`${BASE}/sign-in`, { redirect: "manual" });
    check(signIn.status === 200, "signed out: /sign-in is reachable", `${signIn.status}`);

    // The path the visitor wanted is carried through, so they land there after.
    const deep = await fetch(`${BASE}/orgs/new`, { redirect: "manual" });
    const deepTarget = new URL(deep.headers.get("location") ?? "", BASE);
    check(
      deepTarget.searchParams.get("from") === "/orgs/new",
      "signed out: the intended path is remembered",
      deepTarget.search,
    );
  } finally {
    server.kill("SIGKILL");
    await sleep(500);
  }
}

// With keys configured, and without. Unconfigured must fail closed rather than
// falling open, which is the more dangerous of the two failure modes.
await run("With Supabase configured, no session:", DUMMY_ENV);
await run("With Supabase not configured at all:", {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);
