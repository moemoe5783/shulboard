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

// Syntactically valid, points at nothing. The proxy never reaches the
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

/**
 * Refuse to start if the port already answers.
 *
 * Without this the spawn fails to bind, the failure is invisible because stdio
 * was discarded, and every assertion below grades whatever server was already
 * listening -- a previous build, or a previous branch. A suite that can quietly
 * grade the wrong binary is worse than no suite.
 */
async function assertPortFree() {
  try {
    await fetch(`${BASE}/`, { redirect: "manual" });
  } catch {
    return; // nothing listening, which is what we want
  }
  throw new Error(
    `Something is already listening on ${PORT}. These tests would grade it ` +
      `instead of this build. Stop it and re-run.`,
  );
}

async function startServer(env) {
  await assertPortFree();

  // detached, so the whole process group can be signalled. npx spawns the real
  // server as a grandchild: killing the child alone leaves it orphaned and still
  // holding the port, which is how a stale server ends up grading a later run.
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));

  let exitCode = null;
  child.on("exit", (code) => (exitCode = code));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(500);
    if (exitCode !== null) {
      throw new Error(`the server exited with ${exitCode}:\n${output}`);
    }
    try {
      // Probe "/" rather than the sign-in path: "/" always exists, and where it
      // sends you is the thing under test.
      await fetch(`${BASE}/`, { redirect: "manual" });
      return child;
    } catch {
      // not up yet
    }
  }
  stopServer(child);
  throw new Error(`the server never came up:\n${output}`);
}

/** Kills the process group, then waits for the port to actually be released. */
async function stopServer(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(`${BASE}/`, { redirect: "manual" });
    } catch {
      return; // port released
    }
    await sleep(250);
  }
  throw new Error(`the server on ${PORT} would not release the port`);
}

async function run(label, env) {
  console.log(`\n${label}`);
  const server = await startServer(env);

  try {
    // Protected: everything under app/(app). The destination is read off the
    // redirect rather than written here, so that a sign-in page which moved
    // shows up as a failure instead of a test that agrees with itself.
    let destination = null;
    const protectedPaths = [
      "/",
      "/screens",
      "/screens/new",
      "/screens/00000000-0000-0000-0000-000000000000",
      "/orgs/new",
    ];
    for (const path of protectedPaths) {
      const res = await fetch(BASE + path, { redirect: "manual" });
      const location = res.headers.get("location") ?? "";
      const redirected = res.status >= 300 && res.status < 400;
      check(redirected, `signed out: ${path} is turned away`, `${res.status} ${location}`);
      if (redirected) {
        destination ??= new URL(location, BASE).pathname;
      }
    }

    // A redirect to a route that does not exist is a dead end: the visitor gets
    // a 404 and the build stays green. This is the assertion that catches it.
    if (destination) {
      const landing = await fetch(BASE + destination, { redirect: "manual" });
      check(
        landing.status === 200,
        `signed out: the redirect lands on ${destination}, which serves`,
        `${landing.status}`,
      );
    } else {
      check(false, "signed out: a protected path produced no redirect to follow");
    }

    // Public: the display route has no session and must never be asked for one.
    const display = await fetch(`${BASE}/s/abcdefghijklmnopqrstuvwxyz012345`, {
      redirect: "manual",
    });
    check(display.status === 200, "signed out: /s/[token] stays public", `${display.status}`);

    // Static, no env, no session, public in the proxy — if this ever fails on a
    // deployment, nothing was deployed at all.
    const tokens = await fetch(`${BASE}/tokens`, { redirect: "manual" });
    check(tokens.status === 200, "signed out: a static public page serves", `${tokens.status}`);

    // The regression guard for the server/client boundary. /primitives is a
    // SERVER component rendering Table with cell and rowKey functions, exactly
    // as the dashboard does. When Table was marked "use client" this 500'd,
    // and nothing caught it because every other route in this suite is reached
    // while signed out, so no signed-in page ever rendered.
    const primitives = await fetch(`${BASE}/primitives`, { redirect: "manual" });
    check(
      primitives.status === 200,
      "signed out: a server component renders Table without crossing the boundary",
      `${primitives.status}`,
    );

    // The path the visitor wanted is carried through, so they land there after.
    const deep = await fetch(`${BASE}/orgs/new`, { redirect: "manual" });
    const deepTarget = new URL(deep.headers.get("location") ?? "", BASE);
    check(
      deepTarget.searchParams.get("from") === "/orgs/new",
      "signed out: the intended path is remembered",
      deepTarget.search,
    );
  } finally {
    await stopServer(server);
  }
}

// With keys configured, and without. Unconfigured must fail closed rather than
// falling open, which is the more dangerous of the two failure modes.
await run("With Supabase configured, no session:", DUMMY_ENV);
await run("With Supabase not configured at all:", {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
});
// A dashboard link is the URL people paste by mistake. It has both variables
// present, so a presence-only check would call it configured and then throw
// inside the proxy on every request. Fail closed instead.
await run("With a dashboard URL pasted in by mistake:", {
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.com/dashboard/project/abcdef",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy-anon-key-for-route-tests",
});

/*
 * The cron build worker's own authorization — separate from the session
 * proxy above, because nothing about it goes through a cookie.
 *
 * GET is the one that matters: Vercel Cron always invokes the configured path
 * with a GET request, never POST, and this is what would have shipped a build
 * worker that Vercel could never actually trigger — every scheduled run 405s,
 * quietly, with no screen ever rebuilding and nothing in the UI saying why.
 */
async function runCronAuthChecks() {
  console.log("\nThe cron build worker's authorization:");

  const secret = "test-cron-secret-value";
  const withSecret = await startServer({ ...DUMMY_ENV, CRON_SECRET: secret });
  try {
    for (const method of ["GET", "POST"]) {
      const authorised = await fetch(`${BASE}/api/cron/build-bundles`, {
        method,
        headers: { authorization: `Bearer ${secret}` },
      });
      // 503, not 401 or 405: past the guard, and the only thing missing is a
      // database this test run never configures. That is what proves the
      // guard passed rather than the request failing for some other reason.
      check(
        authorised.status === 503,
        `${method} with the correct bearer token gets past the guard`,
        `${authorised.status}`,
      );

      const wrongToken = await fetch(`${BASE}/api/cron/build-bundles`, {
        method,
        headers: { authorization: "Bearer not-the-secret" },
      });
      check(wrongToken.status === 401, `${method} with the wrong bearer token is refused`, `${wrongToken.status}`);

      const noHeader = await fetch(`${BASE}/api/cron/build-bundles`, { method });
      check(noHeader.status === 401, `${method} with no Authorization header at all is refused`, `${noHeader.status}`);
    }
  } finally {
    await stopServer(withSecret);
  }

  // Fail closed: an unset CRON_SECRET must not mean "any request is fine."
  const withoutSecret = await startServer({ ...DUMMY_ENV, CRON_SECRET: "" });
  try {
    const res = await fetch(`${BASE}/api/cron/build-bundles`, {
      method: "GET",
      headers: { authorization: "Bearer anything-at-all" },
    });
    check(
      res.status === 401,
      "with no CRON_SECRET configured, the worker refuses rather than opening up",
      `${res.status}`,
    );
  } finally {
    await stopServer(withoutSecret);
  }
}

await runCronAuthChecks();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);
