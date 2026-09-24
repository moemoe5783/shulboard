/**
 * The signed-in dashboard, end to end in a real browser, against a fake
 * Supabase (scripts/mock-supabase.mjs) — so it runs with no project, Docker or
 * network:
 *
 *  - SIGN-IN: a wrong password says so; the right one opens the dashboard.
 *  - TWO-STEP: set up an authenticator app on the Account page; the next
 *    sign-in stops at the code step, refuses a wrong code, takes the right one.
 *  - MEMBERS: the list of people and waiting invitations; inviting someone
 *    with email not set up hands back a link to send.
 *  - INVITATIONS: a signed-out visitor sees who's inviting them and can
 *    create an account; the invited account joins with one button.
 *  - TV PAIRING: a TV at /pair shows a code; entering it on the screen's page
 *    connects that TV, which opens the board by itself; the same link on a
 *    second device is refused and sent to pairing; the phone's Connect page
 *    (the TV's QR code) arrives with the code filled in; disconnecting sends
 *    the TV back to showing a code.
 *  - PHONES: every dashboard page at 390px wide has no sideways scrolling and
 *    a menu to reach the other pages (screenshots in the scratch folder when
 *    SHOTS is set).
 *
 * Builds its own copy into .next-mock (NEXT_PUBLIC_* are inlined at build
 * time; every other test runs against a build with none set). Set
 * SKIP_BUILD=1 to reuse the last one.
 *
 * Run with: npm run test:dashboard
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { EDITOR, GABBAI, INVITE_TOKEN, fixtures } from "./dashboard-fixtures.mjs";
import { startMockSupabase } from "./mock-supabase.mjs";

const PORT = Number(process.env.PORT ?? 3231);
const SUPABASE_PORT = 54399;
const BASE = `http://127.0.0.1:${PORT}`;
const DIST = ".next-mock";
const SHOTS = process.env.SHOTS;
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
  console.log("No Chromium found. Set CHROME_PATH to run the dashboard test.");
  process.exit(0);
}

const env = {
  ...process.env,
  NEXT_DIST_DIR: DIST,
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${SUPABASE_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-key-for-dashboard-test",
  // Any value: the service-role routes (TV pairing, the screen routes) talk to
  // the same fake, which doesn't check keys.
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key-for-dashboard-test",
  RESEND_API_KEY: "",
  EMAIL_FROM_ADDRESS: "",
};

if (!process.env.SKIP_BUILD) {
  console.log(`Building into ${DIST} with a fake Supabase URL...`);
  const built = spawnSync("npx", ["next", "build"], { env, stdio: ["ignore", "ignore", "inherit"] });
  if (built.status !== 0) {
    console.log("build failed");
    process.exit(1);
  }
}

const mock = await startMockSupabase({ port: SUPABASE_PORT, users: [GABBAI, EDITOR], fixtures: fixtures() });
const child = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "ignore", detached: true });
for (let i = 0; i < 60; i += 1) {
  await sleep(500);
  try {
    await fetch(`${BASE}/sign-in`);
    break;
  } catch {}
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ executablePath });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(false, "no page errors", error.message));
  const signIn = async (email, password) => {
    await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };

  console.log("\n-- sign-in ---------------------------------------------------");
  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  check(!(await page.getByRole("button", { name: "Continue with Google" }).isVisible()), "Google isn't offered while it's off in Supabase");
  await signIn(GABBAI.email, "not-the-password1");
  await page.locator("p[role=alert]").waitFor({ timeout: 5000 }).catch(() => {});
  check(/don't match an account/.test((await page.locator("p[role=alert]").textContent().catch(() => "")) ?? ""), "a wrong password says so");
  await signIn(GABBAI.email, GABBAI.password);
  await page.waitForURL(`${BASE}/`, { timeout: 10000 }).catch(() => {});
  check(page.url() === `${BASE}/`, "the right password opens the dashboard", page.url());
  check(await page.getByRole("navigation", { name: "Sections" }).isVisible(), "with the rail");

  console.log("\n-- members ---------------------------------------------------");
  await page.goto(`${BASE}/settings/members`, { waitUntil: "networkidle" });
  const people = await page.locator("table").first().textContent();
  check(/Moshe Levi/.test(people) && /Sara Cohen/.test(people) && /\(you\)/.test(people), "the members list shows the shul's people", people?.slice(0, 80));
  check(/treasurer@example\.org/.test(await page.content()), "and the invitation waiting to be accepted");
  await page.fill("#invite-email", "newcomer@example.org");
  await page.selectOption("#invite-role", "editor");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await page.getByLabel("Invitation link").waitFor({ timeout: 5000 }).catch(() => {});
  const link = await page.getByLabel("Invitation link").inputValue().catch(() => "");
  check(/\/invite\/[A-Za-z0-9_-]{32}$/.test(link), "inviting with email not set up hands back a link to send", link);
  const insert = mock.state.writes.find((w) => w.table === "org_invites" && w.method === "POST");
  check(insert?.body?.email === "newcomer@example.org" && insert?.body?.role === "editor", "and saves the invitation", JSON.stringify(insert?.body ?? {}).slice(0, 100));

  console.log("\n-- two-step sign-in ------------------------------------------");
  await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Set up an authenticator app" }).click();
  await page.getByAltText("QR code for your authenticator app").waitFor({ timeout: 5000 });
  check(await page.getByText("JBSW Y3DP EHPK 3PXP").isVisible(), "setting it up shows the QR code and the key");
  await page.fill("#totp-code", "123456");
  await page.getByRole("button", { name: "Turn on" }).click();
  await page.getByText(/^On since/).waitFor({ timeout: 5000 }).catch(() => {});
  check(await page.getByText(/^On since/).isVisible(), "the right code turns it on");

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/sign-in/, { timeout: 10000 });
  await signIn(GABBAI.email, GABBAI.password);
  await page.waitForURL(/\/sign-in\/verify/, { timeout: 10000 }).catch(() => {});
  check(/\/sign-in\/verify/.test(page.url()), "the next sign-in stops at the code step", page.url());
  await page.goto(`${BASE}/boards`, { waitUntil: "networkidle" });
  check(/\/sign-in\/verify\?from=%2Fboards/.test(page.url()), "and the dashboard can't be reached around it", page.url());
  // Typed, not filled: the field is controlled and only takes digits.
  await page.locator("#code").pressSequentially("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("p[role=alert]").waitFor({ timeout: 5000 }).catch(() => {});
  check(/didn't match/.test((await page.locator("p[role=alert]").textContent().catch(() => "")) ?? ""), "a wrong code is refused");
  await page.locator("#code").pressSequentially("123456");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(`${BASE}/boards`, { timeout: 10000 }).catch(() => {});
  check(page.url() === `${BASE}/boards`, "the right code finishes signing in, back where it was going", page.url());

  console.log("\n-- invitations -----------------------------------------------");
  const visitor = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  visitor.on("pageerror", (error) => check(false, "no page errors (visitor)", error.message));
  await visitor.goto(`${BASE}/invite/${INVITE_TOKEN}`, { waitUntil: "networkidle" });
  const invitation = await visitor.locator("main").textContent();
  check(/Join Beis Menachem/.test(invitation) && /Moshe Levi invited newcomer@example\.org/.test(invitation), "signed out, the invitation says who's inviting whom to what", invitation?.slice(0, 120));
  await visitor.getByRole("link", { name: "Create an account" }).click();
  await visitor.waitForURL(/\/sign-up/, { timeout: 10000 });
  check((await visitor.inputValue("#email")) === "newcomer@example.org", "creating an account starts with the invited email filled in");
  await visitor.fill("#name", "Dovid Newman");
  await visitor.fill("#password", "shalom2026");
  await visitor.getByRole("button", { name: "Create account" }).click();
  await visitor.waitForURL(new RegExp(`/invite/${INVITE_TOKEN}`), { timeout: 10000 }).catch(() => {});
  check(visitor.url().endsWith(`/invite/${INVITE_TOKEN}`), "and comes back to the invitation", visitor.url());
  await visitor.getByRole("button", { name: "Join Beis Menachem" }).click();
  await visitor.waitForURL(`${BASE}/`, { timeout: 10000 }).catch(() => {});
  check(mock.state.writes.some((w) => w.rpc === "accept_org_invite" && w.body.p_token === INVITE_TOKEN), "joining accepts the invitation");
  check(visitor.url() === `${BASE}/`, "and opens the shul", visitor.url());

  await visitor.goto(`${BASE}/invite/not-a-real-token-at-all-000000000000`, { waitUntil: "networkidle" });
  check(/doesn't work/.test(await visitor.locator("main").textContent()), "a wrong invitation link says so");

  console.log("\n-- TV pairing ------------------------------------------------");
  {
    const HALL = "5c000000-0000-4000-8000-000000000002";
    const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    tv.on("pageerror", (error) => check(false, "no page errors (TV)", error.message));
    await tv.goto(`${BASE}/pair`, { waitUntil: "networkidle" });
    const codeEl = tv.locator("[data-pairing-code]");
    await codeEl.waitFor({ timeout: 10000 }).catch(() => {});
    const code = await codeEl.getAttribute("data-pairing-code").catch(() => null);
    check(/^\d{6}$/.test(code ?? ""), "a TV at /pair shows a 6-digit code", code ?? "none");
    const qrShot = await tv.getByRole("img", { name: "QR code to connect this TV" }).screenshot().catch(() => null);
    const { default: jsQR } = await import("jsqr");
    const { default: sharp } = await import("sharp");
    const scanned = qrShot
      ? await sharp(qrShot).extend({ top: 40, bottom: 40, left: 40, right: 40, background: "#ffffff" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
          .then(({ data, info }) => jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data)
      : null;
    check(scanned === `${BASE}/connect?code=${code}`, "and a QR code that scans to the Connect page with the code", scanned ?? "no code found");

    // The QR code's page, on a phone.
    const phonePage = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, storageState: await context.storageState() })).newPage();
    await phonePage.goto(`${BASE}/connect?code=${code}`, { waitUntil: "networkidle" });
    check((await phonePage.inputValue("#connect-code").catch(() => "")) === code, "scanning it opens Connect with the code filled in");
    check(/Simcha hall/.test(await phonePage.locator("main, body").first().textContent()), "offering the screens without a TV");

    await page.goto(`${BASE}/screens/${HALL}`, { waitUntil: "networkidle" });
    await page.fill(`#code-${HALL}`, "000000");
    await page.getByRole("button", { name: "Connect TV" }).click();
    await page.locator("p[role=alert]").waitFor({ timeout: 5000 }).catch(() => {});
    check(/wrong or has expired/.test((await page.locator("p[role=alert]").textContent().catch(() => "")) ?? ""), "a wrong code is refused");
    await page.fill(`#code-${HALL}`, code ?? "");
    await page.getByRole("button", { name: "Connect TV" }).click();
    // The page refreshes into its connected state.
    await page.getByText(/^Connected to a/).waitFor({ timeout: 5000 }).catch(() => {});
    check(await page.getByText(/^Connected to a/).isVisible(), "entering it on the screen's page connects the TV", await page.getByText(/^Connected to a/).textContent().catch(() => ""));

    await tv.waitForURL(/\/s\//, { timeout: 15000 }).catch(() => {});
    const tvUrl = tv.url();
    check(/\/s\/[a-z0-9]{32}$/.test(new URL(tvUrl).pathname), "the TV opens its board by itself", tvUrl);
    await tv.waitForTimeout(1500);
    const kept = await tv.evaluate(() => localStorage.getItem("shulboard.screen.token"));
    check(Boolean(kept) && tvUrl.endsWith(kept), "and keeps the link for next time");

    const other = await (await browser.newContext()).newPage();
    await other.goto(tvUrl, { waitUntil: "networkidle" });
    await other.waitForURL(/\/pair\?reason=other-tv/, { timeout: 15000 }).catch(() => {});
    check(/\/pair\?reason=other-tv/.test(other.url()), "the same link on a second device is refused and sent to pairing", other.url());
    check(/connected to a different TV/.test(await other.locator("main").textContent()), "which says why");

    await page.goto(`${BASE}/screens/${HALL}`, { waitUntil: "networkidle" });
    check(/Connected to a/.test(await page.locator("main, body").first().textContent()), "the screen's page says it's connected");
    await page.getByRole("button", { name: "Disconnect TV" }).click();
    await page.locator("form button[type=submit]", { hasText: "Disconnect TV" }).click();
    await page.waitForURL(/disconnected=1/, { timeout: 10000 }).catch(() => {});
    check(/TV disconnected/.test(await page.locator("main, body").first().textContent()), "disconnecting frees the screen");
    await tv.reload({ waitUntil: "networkidle" });
    await tv.waitForURL(/\/pair\?reason=disconnected/, { timeout: 15000 }).catch(() => {});
    check(/\/pair\?reason=disconnected/.test(tv.url()), "and the old TV goes back to showing a code", tv.url());
    await tv.locator("[data-pairing-code]").waitFor({ timeout: 10000 }).catch(() => {});
    check(await tv.locator("[data-pairing-code]").isVisible(), "a fresh one");
    if (SHOTS) await tv.screenshot({ path: join(SHOTS, "tv-pair.png") });
  }

  console.log("\n-- phones ----------------------------------------------------");
  // The gabbai, signed in (and past the code step) above, on a phone.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: await context.storageState(),
  });
  const mobile = await phone.newPage();
  mobile.on("pageerror", (error) => check(false, "no page errors (phone)", error.message));
  const pages = [
    ["overview", "/"],
    ["screens", "/screens"],
    ["screen", "/screens/5c000000-0000-4000-8000-000000000001"],
    ["new-screen", "/screens/new"],
    ["boards", "/boards"],
    ["new-board", "/boards/new"],
    ["media", "/media"],
    ["album", "/media/a1000000-0000-4000-8000-000000000001"],
    ["settings", "/settings"],
    ["members", "/settings/members"],
    ["account", "/account"],
  ];
  for (const [name, path] of pages) {
    await mobile.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const layout = await mobile.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      url: location.pathname,
    }));
    check(layout.url === path && layout.overflow <= 1, `${path} fits a phone's width`, `${layout.url}, ${layout.overflow}px too wide`);
    if (SHOTS) await mobile.screenshot({ path: join(SHOTS, `phone-${name}.png`), fullPage: true });
  }
  {
    await mobile.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const menu = mobile.getByRole("button", { name: "Menu" });
    check(await menu.isVisible(), "a phone gets a menu button instead of the rail");
    await menu.click();
    if (SHOTS) await mobile.screenshot({ path: join(SHOTS, "phone-menu.png") });
    await mobile.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Boards" }).click();
    await mobile.waitForURL(`${BASE}/boards`, { timeout: 5000 }).catch(() => {});
    check(mobile.url() === `${BASE}/boards`, "and the menu reaches the other pages", mobile.url());
    check(!(await mobile.getByRole("navigation", { name: "Sections" }).isVisible()), "then closes");
  }
  {
    // A phone held sideways is wider than a tablet but only ~390px tall.
    const sideways = await (await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, storageState: await context.storageState() })).newPage();
    await sideways.goto(`${BASE}/screens`, { waitUntil: "networkidle" });
    check(await sideways.getByRole("button", { name: "Menu" }).isVisible(), "a phone held sideways gets the phone layout too");
    const overflow = await sideways.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, "and fits", `${overflow}px too wide`);
    if (SHOTS) await sideways.screenshot({ path: join(SHOTS, "phone-sideways.png") });
  }
  {
    // On a desk the rail stays put while the page scrolls.
    const desk = await (await browser.newContext({ viewport: { width: 1280, height: 600 }, storageState: await context.storageState() })).newPage();
    await desk.goto(`${BASE}/settings/members`, { waitUntil: "networkidle" });
    await desk.mouse.wheel(0, 800);
    await desk.waitForTimeout(300);
    const scrolled = await desk.evaluate(() => window.scrollY);
    const railTop = await desk.getByRole("navigation", { name: "Sections" }).evaluate((el) => el.getBoundingClientRect().top);
    const signOut = await desk.getByRole("button", { name: "Sign out" }).isVisible();
    check(scrolled > 100 && Math.abs(railTop) < 1 && signOut, "on a desk the rail stays put while the page scrolls", `scrolled ${scrolled}px, rail top ${railTop}px`);
  }
  const signedOut = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  for (const [name, path] of [
    ["sign-in", "/sign-in"],
    ["sign-up", "/sign-up"],
    ["forgot", "/sign-in/forgot"],
    ["invite", `/invite/${INVITE_TOKEN}`],
  ]) {
    await signedOut.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const overflow = await signedOut.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `${path} fits a phone's width`, `${overflow}px too wide`);
    if (SHOTS) await signedOut.screenshot({ path: join(SHOTS, `phone-${name}.png`), fullPage: true });
  }
  if (SHOTS) {
    for (const [name, path] of [["members", "/settings/members"], ["account", "/account"]]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.screenshot({ path: join(SHOTS, `desktop-${name}.png`), fullPage: true });
    }
    await visitor.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  }
} finally {
  await browser.close();
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
  await mock.close();
}
console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
