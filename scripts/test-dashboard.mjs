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
 *    connects that TV (scanned with the camera, from a fake capture device
 *    playing the TV's own QR code), which opens the board by itself; the same link on a
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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { EDITOR, GABBAI, INVITE_TOKEN, PHOTO, fixtures } from "./dashboard-fixtures.mjs";
import { startMockSupabase } from "./mock-supabase.mjs";

const PORT = Number(process.env.PORT ?? 3231);
const SUPABASE_PORT = 54399;
const BASE = `http://127.0.0.1:${PORT}`;
const DIST = ".next-mock";
const PURGE_LOG = join(process.cwd(), DIST, "fake-vercel.log");
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
  // The media cleanup cron is checked on its default, a dry run.
  CRON_SECRET: "dashboard-test-cron-secret",
  // Vercel's request context, faked, so CDN tags and purges are recorded.
  FAKE_VERCEL_LOG: PURGE_LOG,
  MEDIA_CLEANUP_DRY_RUN: "",
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

rmSync(PURGE_LOG, { force: true });
const mock = await startMockSupabase({ port: SUPABASE_PORT, users: [GABBAI, EDITOR], fixtures: fixtures() });
const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
  env: { ...env, NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${join(process.cwd(), "scripts/fake-vercel-context.mjs")}`.trim() },
  stdio: "ignore",
  detached: true,
});
/** What the faked Vercel context recorded: CDN tags and purges. */
const vercelLog = () =>
  existsSync(PURGE_LOG)
    ? readFileSync(PURGE_LOG, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
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

  console.log("\n-- email links -----------------------------------------------");
  {
    // What a reset email's link looks like (lib/email/templates.ts), asked
    // for by the app (redirect_to carries ?next=) and sent from the Supabase
    // dashboard (redirect_to is just the site).
    const reader = await (await browser.newContext()).newPage();
    const fromApp = `${BASE}/auth/confirm?next=%2Faccount`;
    await reader.goto(`${BASE}/auth/confirm?token_hash=hash-${GABBAI.email}&type=recovery&redirect_to=${encodeURIComponent(fromApp)}`, { waitUntil: "networkidle" });
    check(/\/auth\/new-password\?next=%2Faccount$/.test(reader.url()), "a reset link opens the new-password page, headed back where it was asked from", reader.url());
    await reader.goto(`${BASE}/auth/confirm?token_hash=hash-${GABBAI.email}&type=email&redirect_to=${encodeURIComponent(BASE)}`, { waitUntil: "networkidle" });
    check(reader.url() === `${BASE}/`, "a link sent from the Supabase dashboard still signs in", reader.url());
    await reader.goto(`${BASE}/auth/confirm?token_hash=hash-${GABBAI.email}&type=email&redirect_to=${encodeURIComponent("https://evil.example/steal")}`, { waitUntil: "networkidle" });
    check(reader.url() === `${BASE}/`, "and a link can't send anyone to another site", reader.url());
  }

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
    // Scanning the TV's QR code from the screen's page, with a camera whose
    // picture is that QR code (a fake capture device playing a .y4m file).
    const { encode } = await import("uqr");
    const { tmpdir } = await import("node:os");
    const y4m = join(tmpdir(), `shulboard-tv-qr-${process.pid}.y4m`);
    {
      const { size, data } = encode(`${BASE}/connect?code=${code}`, { ecc: "M", border: 4 });
      const W = 640;
      const H = 480;
      const scale = Math.floor(420 / size);
      const x0 = Math.floor((W - size * scale) / 2);
      const y0 = Math.floor((H - size * scale) / 2);
      const yPlane = Buffer.alloc(W * H, 235);
      for (let y = 0; y < size; y += 1)
        for (let x = 0; x < size; x += 1)
          if (data[y][x])
            for (let dy = 0; dy < scale; dy += 1) yPlane.fill(16, (y0 + y * scale + dy) * W + x0 + x * scale, (y0 + y * scale + dy) * W + x0 + (x + 1) * scale);
      const chroma = Buffer.alloc((W / 2) * (H / 2), 128);
      const frame = Buffer.concat([Buffer.from("FRAME\n"), yPlane, chroma, chroma]);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(y4m, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), frame, frame]));
    }
    const cameraBrowser = await chromium.launch({
      executablePath,
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`],
    });
    try {
      const cameraContext = await cameraBrowser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await context.storageState() });
      await cameraContext.grantPermissions(["camera"], { origin: BASE });
      const scanner = await cameraContext.newPage();
      scanner.on("pageerror", (error) => check(false, "no page errors (scanner)", error.message));
      await scanner.goto(`${BASE}/screens/${HALL}`, { waitUntil: "networkidle" });
      await scanner.getByRole("button", { name: "Scan the TV’s QR code" }).click();
      check(await scanner.locator("[data-qr-scanner] video").isVisible().catch(() => false), "the screen's page opens the camera to scan the TV's QR code");
      if (SHOTS) await scanner.waitForTimeout(800).then(() => scanner.screenshot({ path: join(SHOTS, "phone-scanner.png") }));
      await scanner.getByText(/^Connected to a/).waitFor({ timeout: 15000 }).catch(() => {});
      check(await scanner.getByText(/^Connected to a/).isVisible(), "scanning it connects the TV, nothing typed", await scanner.getByText(/^Connected to a/).textContent().catch(() => ""));
      check(!(await scanner.locator("[data-qr-scanner]").isVisible().catch(() => false)), "and the camera is off again");
    } finally {
      await cameraBrowser.close();
    }

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
    // Server actions held for a moment, the way a real one takes a second or
    // two, so the button's working state is there to see.
    const slowActions = async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    };
    await page.route("**/*", slowActions);
    await page.locator("form button[type=submit]", { hasText: "Disconnect TV" }).click();
    const working = page.locator("form button[type=submit][aria-busy=true]");
    await working.waitFor({ timeout: 3000 }).catch(() => {});
    check((await working.textContent().catch(() => "")) === "Disconnecting" && (await working.locator("svg").count()) === 1,
      "confirming the disconnect shows it's working", (await working.textContent().catch(() => "")) ?? "");
    await page.waitForURL(/disconnected=1/, { timeout: 10000 }).catch(() => {});
    await page.unroute("**/*", slowActions);
    check(/TV disconnected/.test(await page.locator("main, body").first().textContent()), "disconnecting frees the screen");
    await tv.reload({ waitUntil: "networkidle" });
    await tv.waitForURL(/\/pair\?reason=disconnected/, { timeout: 15000 }).catch(() => {});
    check(/\/pair\?reason=disconnected/.test(tv.url()), "and the old TV goes back to showing a code", tv.url());
    await tv.locator("[data-pairing-code]").waitFor({ timeout: 10000 }).catch(() => {});
    check(await tv.locator("[data-pairing-code]").isVisible(), "a fresh one");
    if (SHOTS) await tv.screenshot({ path: join(SHOTS, "tv-pair.png") });
  }

  console.log("\n-- saving shows it's working --------------------------------");
  {
    await page.goto(`${BASE}/screens/5c000000-0000-4000-8000-000000000001`, { waitUntil: "networkidle" });
    const slowActions = async (route) => {
      if (route.request().method() === "POST" && route.request().headers()["next-action"]) await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    };
    await page.route("**/*", slowActions);
    await page.getByLabel("Board").selectOption({ label: "Weekday board (not published)" });
    await page.getByRole("button", { name: "Show this board" }).click();
    const saving = page.locator("button[aria-busy=true]", { hasText: "Saving" });
    await saving.waitFor({ timeout: 3000 }).catch(() => {});
    check(await saving.isVisible().catch(() => false), "choosing a screen's board shows it's saving");
    const saved = page.getByRole("status").filter({ hasText: "Saved." });
    await saved.waitFor({ timeout: 10000 }).catch(() => {});
    check(/^Saved\./.test((await saved.textContent().catch(() => "")) ?? ""), "then says it's saved",
      (await saved.textContent().catch(() => "")) ?? "");
    const chosenLabel = await page.getByLabel("Board").evaluate((el) => el.options[el.selectedIndex]?.textContent ?? "");
    check(/Weekday board/.test(chosenLabel), "and the choice stays showing, rather than going back to Choose a board", chosenLabel);
    await page.unroute("**/*", slowActions);

    // A new album: the box stays up and working until the album's own page is
    // there, rather than closing onto the old list.
    await page.goto(`${BASE}/media`, { waitUntil: "networkidle" });
    await page.route("**/*", slowActions);
    await page.getByRole("button", { name: "New album" }).first().click();
    await page.getByPlaceholder("Kiddush photos").fill("Siyum photos");
    await page.getByRole("button", { name: "Add album" }).click();
    const adding = page.locator("button[aria-busy=true]");
    await adding.waitFor({ timeout: 3000 }).catch(() => {});
    check(/Adding|Opening album/.test((await adding.textContent().catch(() => "")) ?? ""), "adding an album shows it's working",
      (await adding.textContent().catch(() => "")) ?? "");
    await page.waitForURL(/\/media\/[0-9a-f-]{36}$/, { timeout: 10000 }).catch(() => {});
    check(/\/media\/[0-9a-f-]{36}$/.test(page.url()) && /Siyum photos/.test(await page.locator("body").textContent()),
      "until its own page opens", page.url());

    await page.getByRole("button", { name: "Delete album" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete album" }).click();
    const deleting = page.locator("button[aria-busy=true]", { hasText: "Deleting" });
    await deleting.waitFor({ timeout: 3000 }).catch(() => {});
    check(await deleting.isVisible().catch(() => false), "deleting an album shows it's working");
    await page.waitForURL(`${BASE}/media`, { timeout: 10000 }).catch(() => {});
    check(page.url() === `${BASE}/media` && !/Siyum photos/.test(await page.locator("body").textContent()), "and it's gone from the list");
    await page.unroute("**/*", slowActions);

    // Following a link shows the page is loading straight away.
    await page.route("**/*", async (route) => {
      if (route.request().headers()["rsc"]) await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.getByRole("link", { name: "Settings" }).first().click();
    const loadingPage = page.locator("[data-page-loading]");
    await loadingPage.waitFor({ timeout: 3000 }).catch(() => {});
    check(await loadingPage.isVisible().catch(() => false), "a page that takes a moment says it's loading");
    await page.waitForURL(`${BASE}/settings`, { timeout: 10000 }).catch(() => {});
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // Publishing a board: working while it runs, then says it's done — never
    // just a button that went grey.
    await page.goto(`${BASE}/boards/b0000000-0000-4000-8000-000000000002`, { waitUntil: "networkidle" });
    await page.route("**/*", slowActions);
    const publishButton = page.getByRole("button", { name: /^Publish/ });
    await publishButton.click();
    const publishing = page.locator("button[aria-busy=true]", { hasText: "Publishing" });
    await publishing.waitFor({ timeout: 3000 }).catch(() => {});
    check(await publishing.isVisible().catch(() => false), "publishing a board shows it's working");
    const publishState = page.locator("[data-publish-state]");
    await page.waitForFunction(() => /^Published/.test(document.querySelector("[data-publish-state]")?.textContent ?? ""), null, { timeout: 10000 }).catch(() => {});
    const publishedText = (await publishState.textContent().catch(() => "")) ?? "";
    check(/^Published/.test(publishedText) && !/No changes/.test(publishedText), "then says it's published", publishedText);
    await page.unroute("**/*", slowActions);
    await page.reload({ waitUntil: "networkidle" });
    const idleText = (await publishState.textContent().catch(() => "")) ?? "";
    check(/No changes to publish/.test(idleText), "and later, with nothing new, says there's nothing to publish", idleText);

    // Back into a board just edited: the edit, not the page as first loaded
    // (the router's cached copy) — and not saved over by it.
    {
      await page.locator("summary", { hasText: "Add element" }).click();
      await page.locator("[data-add-menu] button", { hasText: /^Title/ }).first().click();
      await page.waitForTimeout(1500);
      const widget = page.locator("[data-editor-surface] [data-widget-id]").first();
      const leftOf = () => widget.evaluate((el) => el.style.left);
      const before = await leftOf();
      for (let i = 0; i < 3; i += 1) await page.keyboard.press("Shift+ArrowRight");
      const edited = await leftOf();
      // Away inside the autosave's second, then Back.
      await page.locator('a[href="/boards"]').first().click();
      await page.waitForURL(`${BASE}/boards`, { timeout: 10000 }).catch(() => {});
      await page.goBack({ waitUntil: "networkidle" });
      await widget.waitFor({ timeout: 10000 }).catch(() => {});
      const after = await leftOf().catch(() => "");
      check(edited !== before && after === edited, "Back into a board just edited shows the edit, not the page as it first loaded", `${before} -> ${edited}, back: ${after}`);
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(1500);
    }

    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    check((await page.getByLabel("Timezone").count()) === 0, "settings don't ask for a timezone");
    check(/Times are shown in Eastern Time/.test(await page.locator("body").textContent()), "they say the one the address gave");
  }

  console.log("\n-- platform admin --------------------------------------------");
  {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    check((await page.getByRole("link", { name: "Platform admin" }).count()) >= 1, "a platform admin gets a Platform admin row in the menu");
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    const summary = (await page.locator("[data-admin-summary]").textContent()) ?? "";
    check(/1 shul: 1 on a free trial, 0 on Basic, 0 on Pro\. 2 screens, 1 live now\./.test(summary),
      "the admin sees every shul, with plans and screens", summary);
    const usage = (await page.locator("[data-admin-usage]").textContent()) ?? "";
    check(/Storage holds 7\.1 MB in 14 files, 700 KB of it belonging to no shul\. The database is 12\.3 MB\./.test(usage),
      "and the project's storage and database size", usage);
    const row = page.locator("tr", { hasText: "Beis Menachem" });
    check(/Free trial/.test((await row.textContent()) ?? "") && /6\.4 MB/.test((await row.textContent()) ?? ""), "each shul's row shows its plan and real storage");
    await page.getByRole("link", { name: "Beis Menachem" }).click();
    await page.waitForURL(/\/admin\/shuls\//, { timeout: 10000 }).catch(() => {});
    check(/6\.4 MB in 12 files/.test((await page.locator("[data-admin-shul-facts]").textContent()) ?? "") &&
        /2\.2 MB of that is files no photo in Media accounts for/.test((await page.locator("[data-admin-leftover]").textContent().catch(() => "")) ?? ""),
      "a shul's page shows its files, and how much of them no photo accounts for");
    await page.getByLabel("Plan").selectOption("pro");
    await page.getByRole("button", { name: "Save plan" }).click();
    await page.getByRole("status").filter({ hasText: "Saved" }).waitFor({ timeout: 10000 }).catch(() => {});
    check(await page.getByRole("status").filter({ hasText: "Saved" }).isVisible().catch(() => false), "the admin moves the shul to Pro");
    check((await page.getByLabel("Plan").inputValue()) === "pro", "and the choice stays showing");
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "admin-shul.png"), fullPage: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    check(/Pro/.test((await page.locator("tr", { hasText: "Beis Menachem" }).textContent()) ?? ""), "the list shows the new plan");
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "admin-shuls.png"), fullPage: true });

    await page.goto(`${BASE}/admin/accounts`, { waitUntil: "networkidle" });
    const editorRow = page.locator("tr", { hasText: "Sara Cohen" });
    await editorRow.getByRole("button", { name: "Make admin" }).click();
    await editorRow.getByRole("button", { name: "Make admin" }).click();
    await editorRow.getByRole("button", { name: "Remove admin" }).waitFor({ timeout: 10000 }).catch(() => {});
    check(await editorRow.getByRole("button", { name: "Remove admin" }).isVisible().catch(() => false), "the admin makes another account an admin, after a confirm");
    check(/Admin \(you\)/.test((await page.locator("tr", { hasText: "Moshe Levi" }).textContent()) ?? ""), "and can't remove themselves");
    await editorRow.getByRole("button", { name: "Remove admin" }).click();
    await editorRow.getByRole("button", { name: "Make admin" }).waitFor({ timeout: 10000 }).catch(() => {});
    check(await editorRow.getByRole("button", { name: "Make admin" }).isVisible().catch(() => false), "and remove them again");
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "admin-accounts.png"), fullPage: true });
    await page.goto(`${BASE}/admin/accounts?q=sara`, { waitUntil: "networkidle" });
    check((await page.locator("input[name=q]").inputValue()) === "sara", "the account search keeps what was searched");
  }

  console.log("\n-- the media proxy -------------------------------------------");
  {
    const url = (id, file = "display-1111111111111111.webp") => `${BASE}/m/${id}/${file}`;
    const ready = await fetch(url(PHOTO.ready));
    check(ready.status === 200 && (await ready.text()) === "fake-webp-bytes", "a ready photo is served", String(ready.status));
    check(ready.headers.get("content-type") === "image/webp", "with its recorded type", ready.headers.get("content-type") ?? "");
    check(
      ready.headers.get("cache-control") === "public, max-age=31536000, immutable",
      "browsers keep it for a year, immutable",
      ready.headers.get("cache-control") ?? "",
    );
    check(
      ready.headers.get("cdn-cache-control") === "max-age=31536000" && ready.headers.get("vercel-cdn-cache-control") === "max-age=31536000",
      "and so does Vercel's CDN",
      `${ready.headers.get("cdn-cache-control")} / ${ready.headers.get("vercel-cdn-cache-control")}`,
    );
    check(!ready.headers.get("set-cookie"), "no cookie rides along, which would stop the CDN caching it");
    for (const [label, response] of [
      ["a deleted photo", await fetch(url(PHOTO.deleted))],
      ["a photo still uploading", await fetch(url(PHOTO.pending))],
      ["a stale hash", await fetch(url(PHOTO.ready, "display-2222222222222222.webp"))],
      ["an unknown photo", await fetch(url("a5000000-0000-4000-8000-00000000ffff"))],
    ]) {
      check(
        response.status === 404 && response.headers.get("cache-control") === "public, max-age=60" && response.headers.get("vercel-cdn-cache-control") === "max-age=60",
        `${label} is a 404 cached for a minute`,
        `${response.status} ${response.headers.get("cache-control")}`,
      );
    }
    // A file the row names but Storage can't produce is a hiccup, not a
    // missing photo: a 503 that nothing remembers.
    const hiccup = await fetch(url(PHOTO.fileMissing));
    check(
      hiccup.status === 503 && hiccup.headers.get("cache-control") === "no-store",
      "a Storage failure is a 503 that isn't cached",
      `${hiccup.status} ${hiccup.headers.get("cache-control")}`,
    );
  }

  console.log("\n-- media cleanup (dry run) -----------------------------------");
  {
    const before = mock.state.writes.length;
    const refused = await fetch(`${BASE}/api/cron/clean-media`, { method: "POST" });
    check(refused.status === 401, "the cleanup cron refuses a call without the secret", String(refused.status));
    const response = await fetch(`${BASE}/api/cron/clean-media`, {
      method: "POST",
      headers: { authorization: "Bearer dashboard-test-cron-secret" },
    });
    const report = await response.json().catch(() => ({}));
    check(response.ok && report.dryRun === true, "with no setting it's a dry run", JSON.stringify(report).slice(0, 200));
    check(report.retentionDays === 30, "photos are kept 30 days", String(report.retentionDays));
    check(
      report.trash?.purged?.length === 1 && report.trash.purged[0] === PHOTO.expired && report.trash.files === 1,
      "it reports the photo past 30 days, and its file, as due",
      JSON.stringify(report.trash?.purged),
    );
    const kept = report.trash?.kept?.[0];
    check(
      kept?.assetId === PHOTO.deleted && kept.boards?.[0]?.name === "Weekday board",
      "a due photo a board still names is kept, reported with the board's name",
      JSON.stringify(report.trash?.kept),
    );
    check(report.orphans?.found === 1 && report.orphans.removed === 0, "it finds the orphan file and leaves it", JSON.stringify(report.orphans));
    const writes = mock.state.writes.slice(before);
    check(
      !writes.some((w) => w.storageRemove || (w.table && w.method === "DELETE")),
      "and a dry run deletes nothing",
      writes.map((w) => w.storageRemove ? "storage" : `${w.method} ${w.table}`).join(", "),
    );
  }

  console.log("\n-- recently deleted ------------------------------------------");
  {
    await page.goto(`${BASE}/media`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Recently deleted" }).click();
    await page.waitForURL(`${BASE}/media/deleted`);
    await page.getByRole("heading", { name: "Recently deleted" }).waitFor();
    const row = (name) => page.locator("tr", { hasText: name });
    check(await row("purim-seudah.jpg").isVisible(), "a photo deleted yesterday is listed");
    check(((await row("purim-seudah.jpg").textContent()) ?? "").includes("In 29 days"), "with the days left until it's deleted for good");
    check(((await row("old-kiddush.jpg").textContent()) ?? "").includes("Tonight"), "one past 30 days goes tonight");
    if (SHOTS) {
      await row("purim-seudah.jpg").locator("input[type=checkbox]").check();
      await page.screenshot({ path: join(SHOTS, "recently-deleted.png"), fullPage: true });
      await row("purim-seudah.jpg").locator("input[type=checkbox]").uncheck();
    }
    const thumb = await row("purim-seudah.jpg").locator("img").getAttribute("src");
    check(Boolean(thumb?.includes("/object/sign/assets/")), "its thumbnail is a signed URL, since /m won't serve a deleted photo", thumb ?? "");

    await page.getByRole("button", { name: "Select all" }).click();
    const ticked = await page.locator("tbody input[type=checkbox]:checked").count();
    const boxes = await page.locator("tbody input[type=checkbox]").count();
    check(ticked === boxes && boxes >= 2, "Select all ticks every deleted photo", `${ticked} of ${boxes}`);
    check(((await page.locator("[data-selection-bar]").textContent()) ?? "").includes(`${boxes} photos selected`), "and the bar counts them");
    await page.locator("[data-selection-bar]").getByRole("button", { name: "Clear" }).click();

    let before = mock.state.writes.length;
    await row("purim-seudah.jpg").getByRole("button", { name: "Restore", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Restored 1 photo" }).waitFor({ timeout: 10000 }).catch(() => {});
    const restored = mock.state.writes
      .slice(before)
      .find((w) => w.table === "assets" && w.method === "PATCH" && w.body.deleted_at === null && w.query.includes(PHOTO.deleted));
    check(Boolean(restored), "Restore clears the photo's deleted date");
    check(await page.getByRole("status").filter({ hasText: "Restored 1 photo" }).isVisible(), "and says so");

    before = mock.state.writes.length;
    await row("old-kiddush.jpg").getByRole("button", { name: "Delete old-kiddush.jpg for good" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete for good" });
    check(((await dialog.textContent()) ?? "").includes("can’t be undone"), "deleting for good asks first, and says it can't be undone");
    await dialog.getByRole("button", { name: "Delete for good" }).click();
    await page.getByRole("status").filter({ hasText: "for good" }).waitFor({ timeout: 10000 }).catch(() => {});
    const writes = mock.state.writes.slice(before);
    const removed = writes.find((w) => w.storageRemove === "assets");
    check(
      Boolean(removed?.paths?.some((p) => p.includes(PHOTO.expired))),
      "its files are removed from Storage",
      JSON.stringify(removed?.paths ?? []),
    );
    const removeAt = writes.indexOf(removed);
    const rowDelete = writes.findIndex((w) => w.table === "assets" && w.method === "DELETE" && w.query.includes(PHOTO.expired));
    check(rowDelete > removeAt && removeAt >= 0, "then its row is deleted, files first");
    check(await page.getByRole("status").filter({ hasText: "Deleted 1 photo for good." }).isVisible(), "and it says so");
  }

  console.log("\n-- the CDN hears about deletes -------------------------------");
  {
    check(vercelLog().some((e) => e.addCacheTag === `asset-${PHOTO.ready}`), "a served photo is tagged with its id");
    check(
      vercelLog().some((e) => e.purge?.includes(`asset-${PHOTO.expired}`)),
      "deleting a photo for good purges its tag",
    );
    // Delete the ready photo from its album, the ordinary way.
    await page.goto(`${BASE}/media/a1000000-0000-4000-8000-000000000001`, { waitUntil: "networkidle" });
    await page.getByRole("checkbox", { name: "Select photo" }).first().check();
    await page.locator("[data-selection-bar]").getByRole("button", { name: /^Delete 1 photo$/ }).click();
    await page.locator("[data-selection-bar]").getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Deleted 1 photo" }).waitFor({ timeout: 10000 }).catch(() => {});
    check(
      mock.state.writes.some((w) => w.table === "assets" && w.method === "PATCH" && w.body.deleted_at && w.query.includes(PHOTO.ready)),
      "deleting a photo in Media soft-deletes it",
    );
    check(
      vercelLog().some((e) => e.purge?.includes(`asset-${PHOTO.ready}`)),
      "and purges its CDN copies straight away",
      JSON.stringify(vercelLog().filter((e) => e.purge)),
    );
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
    ["admin", "/admin"],
    ["admin-accounts", "/admin/accounts"],
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
