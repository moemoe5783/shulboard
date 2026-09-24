/**
 * The CDN purge (lib/storage/cdn.ts) against a fake Vercel request context —
 * the same global @vercel/functions reads on a real deployment.
 *
 *   - every photo's tag is purged, in batches of 100;
 *   - a batch the CDN refuses is a warning and `false`, never a throw, so the
 *     delete it follows still succeeds;
 *   - outside Vercel (no context) it quietly does nothing.
 *
 * Run with: npm run test:cdn-purge
 */

import { assetCacheTag, purgeAssetsFromCdn } from "../lib/storage/cdn.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

const CONTEXT = Symbol.for("@vercel/request-context");
const calls: string[][] = [];
let refuse = false;
(globalThis as Record<symbol, unknown>)[CONTEXT] = {
  get: () => ({
    purge: {
      dangerouslyDeleteByTag: async (tags: string | string[]) => {
        if (refuse) throw new Error("purge refused");
        calls.push(Array.isArray(tags) ? tags : [tags]);
      },
    },
  }),
};

const ids = Array.from({ length: 250 }, (_, i) => `a5000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
check(await purgeAssetsFromCdn(ids), "a purge the CDN accepts reports success");
check(calls.length === 3 && calls.map((c) => c.length).join(",") === "100,100,50", "250 photos go in batches of 100", calls.map((c) => c.length).join(","));
check(calls.flat().join() === ids.map(assetCacheTag).join(), "every photo's asset-<id> tag is purged, once");
check(assetCacheTag(ids[0]) === `asset-${ids[0]}`, "the tag is asset-<id>, the one the proxy sets");

calls.length = 0;
check(await purgeAssetsFromCdn([]), "nothing to purge is a success with no call");
check(calls.length === 0, "and makes no call");

refuse = true;
const warnings: unknown[] = [];
const warn = console.warn;
console.warn = (...args: unknown[]) => warnings.push(args);
let threw = false;
let result = true;
try {
  result = await purgeAssetsFromCdn(ids.slice(0, 3));
} catch {
  threw = true;
}
console.warn = warn;
check(!threw && result === false, "a refused purge returns false rather than throwing");
check(warnings.length === 1, "and logs one warning", String(warnings.length));

delete (globalThis as Record<symbol, unknown>)[CONTEXT];
refuse = false;
check(await purgeAssetsFromCdn(ids.slice(0, 1)), "outside Vercel it does nothing, successfully");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
