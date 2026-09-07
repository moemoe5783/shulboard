/**
 * Bundle core unit tests.
 *
 * The hash decides whether `version` bumps, and `version` decides whether every
 * screen in a shul refetches and cross-fades. That makes canonical hashing the
 * single most consequential pure function in the display path — and one whose
 * failure mode is invisible: a hash that varies with key order still passes any
 * test that builds twice from the same fixture, because a fixture has stable key
 * order. So these tests deliberately reorder keys.
 *
 * Run with: npm run test:bundle
 */

import { canonicalJson, etagFor, etagMatches, hashPayload } from "../lib/bundle/hash.ts";
import { mediaProxyPath, parseVariantFile, readAssetVariant } from "../lib/bundle/media.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

// ---- canonical form -------------------------------------------------------

check(
  canonicalJson({ b: 1, a: 2 }) === canonicalJson({ a: 2, b: 1 }),
  "key order does not change the canonical form",
);

check(
  canonicalJson({ a: { z: 1, y: 2 } }) === canonicalJson({ a: { y: 2, z: 1 } }),
  "nested keys are sorted too",
);

check(
  canonicalJson([1, 2, 3]) !== canonicalJson([3, 2, 1]),
  "array order is content and is preserved — a playlist is a sequence",
);

check(
  canonicalJson({ a: 1, b: undefined }) === canonicalJson({ a: 1 }),
  "an undefined field is the same as an absent one",
);

check(canonicalJson({ a: null }) !== canonicalJson({}), "null is a value, unlike undefined");

// ---- the hash, and what it means for version ------------------------------

const base = {
  screen: { id: "s1", name: "Main lobby", canvas: { width: 1920, height: 1080 }, orientation: "landscape", timezone: "UTC", hebrewPrefs: {} },
  theme: {},
  playlist: { id: "p1", name: "Weekday", items: [{ boardId: "b1", position: 0, durationSeconds: 30 }] },
  boards: [],
  content: { announcements: [], schedules: [], people: [], events: [], zmanim: {} },
  assets: [],
} as never;

const reordered = {
  assets: [],
  content: { zmanim: {}, events: [], people: [], schedules: [], announcements: [] },
  boards: [],
  playlist: { items: [{ durationSeconds: 30, position: 0, boardId: "b1" }], name: "Weekday", id: "p1" },
  theme: {},
  screen: { hebrewPrefs: {}, timezone: "UTC", orientation: "landscape", canvas: { height: 1080, width: 1920 }, name: "Main lobby", id: "s1" },
} as never;

check(
  hashPayload(base) === hashPayload(reordered),
  "the same content in a different key order hashes the same",
  `${hashPayload(base).slice(0, 12)} / ${hashPayload(reordered).slice(0, 12)}`,
);

const changed = JSON.parse(JSON.stringify(base));
changed.screen.name = "Beis medrash";
check(hashPayload(base) !== hashPayload(changed), "a real change changes the hash");

// The trap this split exists to avoid: builtAt must not be inside the payload,
// or every rebuild bumps version and every screen cross-fades for nothing.
const withTime = JSON.parse(JSON.stringify(base));
withTime.builtAt = new Date().toISOString();
check(
  hashPayload(base) !== hashPayload(withTime),
  "a build timestamp WOULD change the hash — which is why it lives in the envelope",
);

// ---- ETag comparison ------------------------------------------------------

check(etagFor("abc") === '"abc"', "the ETag is the hash in quotes");
check(etagMatches('"abc"', "abc"), "a quoted ETag matches");
check(etagMatches("abc", "abc"), "an unquoted one matches too — proxies vary");
check(etagMatches('W/"abc"', "abc"), "a weak validator matches");
check(etagMatches('"other", "abc"', "abc"), "a list matches on any member");
check(etagMatches("*", "abc"), "the wildcard matches");
check(!etagMatches('"abd"', "abc"), "a different hash does not match");
check(!etagMatches(null, "abc"), "no header does not match");

// ---- media proxy paths ----------------------------------------------------

const asset = { id: "a1", variant: "display", content_hash: "a3f9", extension: "webp" };
check(
  mediaProxyPath(asset) === "/m/a1/display-a3f9.webp",
  "a media path is /m/<id>/<variant>-<hash>.<ext>",
  mediaProxyPath(asset),
);
check(
  mediaProxyPath({ ...asset, content_hash: "b7c2" }) !== mediaProxyPath(asset),
  "re-processing an asset changes its path — a cache miss, never a stale hit",
);
check(
  !mediaProxyPath(asset).includes("?"),
  "and it carries no query string, so it can never carry an expiry",
);

// ---- splitting the proxy filename back apart ------------------------------

check(
  JSON.stringify(parseVariantFile("display-a3f9.webp")) ===
    JSON.stringify({ variant: "display", contentHash: "a3f9", extension: "webp" }),
  "a variant file splits on its last dash and last dot",
);
check(
  parseVariantFile("thumb-abc-123.jpg")?.variant === "thumb-abc",
  "a hash-shaped variant name still splits at the LAST dash, not the first",
);
check(parseVariantFile("no-extension") === null, "no dot at all is not a variant file");
check(parseVariantFile("nodash.jpg") === null, "no dash at all is not a variant file");
check(parseVariantFile(".jpg") === null, "a dot with nothing before it doesn't split");
check(parseVariantFile("a-.jpg") === null, "a dash with nothing before it doesn't split");

// ---- reading a variant out of assets.variants -----------------------------

const variants = {
  display: {
    storage_path: "org1/a1/display.webp",
    content_hash: "a3f9",
    extension: "webp",
    content_type: "image/webp",
    bytes: 45000,
  },
};

check(
  JSON.stringify(readAssetVariant(variants, "display")) ===
    JSON.stringify({
      storagePath: "org1/a1/display.webp",
      contentHash: "a3f9",
      extension: "webp",
      contentType: "image/webp",
      bytes: 45000,
    }),
  "a variant present in the jsonb reads back in full",
);
check(readAssetVariant(variants, "thumb") === null, "a variant not yet generated reads as null");
check(readAssetVariant({}, "display") === null, "an asset with no variants at all reads as null");
check(readAssetVariant(null, "display") === null, "a null variants column reads as null, not a throw");
check(
  readAssetVariant({ display: { storage_path: "x" } }, "display") === null,
  "a variant missing required fields reads as null rather than a partial object",
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
