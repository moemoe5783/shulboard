/**
 * The photo upload, in a real browser — /upload-lab runs lib/media/upload.ts
 * against a recording fake of Supabase, so every failure can be forced and
 * what the upload did about it checked:
 *
 *  - the row goes in first, as 'pending', before any file;
 *  - a size that won't upload takes back the ones that did and marks the row
 *    'failed' with the reason, and no album link is made;
 *  - an album link refused undoes the whole upload the same way;
 *  - a ready copy of the same file is reused; one mid-upload in another tab
 *    is waited for; one abandoned long ago is marked failed and replaced.
 *
 * Needs a production build; starts its own `next start`.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3219);
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
  console.log("No Chromium found. Set CHROME_PATH to run the upload test.");
  process.exit(0);
}

const child = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
for (let i = 0; i < 60; i += 1) {
  await sleep(500);
  try {
    await fetch(`${BASE}/upload-lab`);
    break;
  } catch {}
}

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/upload-lab`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__uploadLab));
  const run = (scenario) => page.evaluate((s) => window.__uploadLab.run(s), scenario);

  const ops = (calls) => calls.map((c) => `${c.op}${c.table ? `:${c.table}` : ""}`);
  const assetWrites = (calls) => calls.filter((c) => c.table === "assets" && c.op !== "select");
  const uploads = (calls) => calls.filter((c) => c.op === "upload");
  const removes = (calls) => calls.filter((c) => c.op === "remove").flatMap((c) => c.detail);

  {
    const { result, calls } = await run({ width: 3000, height: 2000 });
    const writes = assetWrites(calls);
    const firstUpload = calls.findIndex((c) => c.op === "upload");
    const insertAt = calls.findIndex((c) => c.op === "insert" && c.table === "assets");
    check(result.ok && !result.deduped, "a photo uploads", JSON.stringify(result));
    check(insertAt >= 0 && insertAt < firstUpload, "the row is written before any file", ops(calls).join(" "));
    check(writes[0]?.detail.payload.status === "pending", "the row starts pending", writes[0]?.detail.payload.status);
    const ready = writes.find((w) => w.op === "update" && w.detail.payload.status === "ready");
    check(Boolean(ready), "the row is marked ready once every size is up");
    check(
      Boolean(ready) && Object.keys(ready.detail.payload.variants).length === uploads(calls).length,
      "the ready row lists every size that was uploaded",
      ready ? Object.keys(ready.detail.payload.variants).join(", ") : "",
    );
    const readyAt = calls.indexOf(ready);
    const linkAt = calls.findIndex((c) => c.op === "insert" && c.table === "album_items");
    check(linkAt > readyAt, "the album link comes after the row is ready");
    check(removes(calls).length === 0, "nothing is removed on success");
  }

  {
    const { result, calls } = await run({ width: 1000, height: 750 });
    const names = uploads(calls).map((c) => c.detail.path.split("/").pop().split("-")[0]);
    check(result.ok && names.join(",") === "thumb,display", "a 1000px photo uploads thumb and display only", names.join(","));
  }

  {
    const { result, calls } = await run({ width: 3000, height: 2000, failUploadAt: 1 });
    const up = uploads(calls);
    const failed = assetWrites(calls).find((w) => w.op === "update" && w.detail.payload.status === "failed");
    check(!result.ok, "a size that won't upload fails the upload", result.error);
    check(
      removes(calls).length === 1 && removes(calls)[0] === up[0].detail.path,
      "the size already uploaded is removed",
      removes(calls).join(", "),
    );
    check(Boolean(failed?.detail.payload.processing_error), "the row is marked failed with the reason", failed?.detail.payload.processing_error);
    check(!calls.some((c) => c.table === "album_items"), "no album link is made");
    check(up.length === 2, "nothing more is uploaded after the failure", `${up.length} uploads`);
  }

  {
    const { result, calls } = await run({ width: 3000, height: 2000, failLink: true });
    const up = uploads(calls).map((c) => c.detail.path);
    const failed = assetWrites(calls).find((w) => w.op === "update" && w.detail.payload.status === "failed");
    check(!result.ok, "a refused album link fails the upload", result.error);
    check(up.length > 0 && up.every((path) => removes(calls).includes(path)), "every uploaded size is removed", `${removes(calls).length} of ${up.length}`);
    check(Boolean(failed), "the row is marked failed");
  }

  {
    const { result, calls } = await run({
      width: 800,
      height: 600,
      existing: { id: "a5000000-0000-4000-8000-000000000009", status: "ready", created_at: new Date().toISOString() },
    });
    check(result.ok && result.deduped, "a ready copy of the same file is reused", JSON.stringify(result));
    check(uploads(calls).length === 0 && assetWrites(calls).length === 0, "and nothing is uploaded or written to assets");
  }

  {
    const { result, calls } = await run({
      width: 800,
      height: 600,
      existing: { id: "a5000000-0000-4000-8000-000000000009", status: "pending", created_at: new Date().toISOString() },
    });
    check(!result.ok && /still uploading/.test(result.error), "a copy mid-upload in another tab is waited for", result.error);
    check(uploads(calls).length === 0, "and no second copy is uploaded");
  }

  {
    const { result, calls } = await run({
      width: 800,
      height: 600,
      existing: {
        id: "a5000000-0000-4000-8000-000000000009",
        status: "pending",
        created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    });
    const abandoned = assetWrites(calls).find(
      (w) => w.op === "update" && w.detail.filters.some(([f, v]) => f === "eq:id" && v === "a5000000-0000-4000-8000-000000000009"),
    );
    check(abandoned?.detail.payload.status === "failed", "an upload abandoned an hour ago is marked failed");
    check(result.ok && !result.deduped, "and the photo uploads afresh", JSON.stringify(result));
  }

  {
    const { result } = await run({ width: 800, height: 600, insertErrorCode: "23505", existing: null });
    check(!result.ok, "a lost insert race with nothing to reuse reports the failure", result.error);
  }
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
