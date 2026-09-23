/**
 * lib/board-background.ts and lib/board-palette.ts — the background value
 * format, the gradient round trip the editor relies on, tone detection (which
 * decides whether a board's text flips to light), pictures on the board and
 * never on a widget, the bundle carrying a background photo, and the picture
 * library's import script. scripts/test-backgrounds-browser.mjs checks the
 * pictures draw in a real browser.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  backgroundCss,
  boardBackgroundCss,
  toneForLuminance,
  backgroundKind,
  backgroundTone,
  gradientCss,
  parseGradient,
  type GradientSpec,
} from "../lib/board-background.ts";
import { PALETTE, PALETTE_COLORS } from "../lib/board-palette.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("\n-- the value format ------------------------------------------");
check(backgroundKind("") === "none" && backgroundCss("") === undefined, "empty is no background");
check(backgroundKind("#1b2a2e") === "color" && backgroundCss("#1b2a2e") === "#1b2a2e", "a colour is itself");
check(backgroundKind("preset:midnight") === "none", "a removed drawn preset is no background, not an invalid colour");
check(backgroundKind("image:abc") === "image" && backgroundKind("library:candles") === "image", "Media photos and library pictures are pictures");
check(backgroundCss("image:abc") === undefined && backgroundCss("library:candles") === undefined, "a picture never draws on a widget's box");
check(
  (boardBackgroundCss({ value: "image:abc", src: "/m/abc/large-1.webp" }) ?? "").includes('url("/m/abc/large-1.webp") center / cover'),
  "a Media photo covers the board",
);
check(boardBackgroundCss({ value: "image:abc" }) === undefined, "a photo with no resolved src draws nothing rather than a broken URL");
check(boardBackgroundCss({ value: "library:no-such-picture" }) === undefined, "an unknown library picture draws nothing");
check(
  /^linear-gradient\(rgba\(0, 0, 0, 0.4\)/.test(boardBackgroundCss({ value: "image:abc", src: "/m/a.webp", dim: 40 }) ?? ""),
  "darkening lays a veil over the photo",
);
check(
  !(boardBackgroundCss({ value: "image:abc", src: "/m/a.webp", dim: 400 }) ?? "").includes("rgba(0, 0, 0, 4)"),
  "the veil is capped so a picture never goes black",
);
check(toneForLuminance(0.5) === "light" && toneForLuminance(0.5, 80) === "dark", "darkening a light photo enough makes it dark");

console.log("\n-- gradients round-trip ----------------------------------------");
const specs: GradientSpec[] = [
  { type: "linear", angle: 160, stops: [{ color: "#0b1a33", at: 0 }, { color: "#1d4fa3", at: 100 }] },
  { type: "radial", angle: 180, stops: [{ color: "#ffffff", at: 0 }, { color: "#d4af37", at: 50 }, { color: "#000000", at: 100 }] },
];
for (const spec of specs) {
  const back = parseGradient(gradientCss(spec));
  check(JSON.stringify(back) === JSON.stringify(spec), `${spec.type} with ${spec.stops.length} stops reads back exactly`, gradientCss(spec));
}
check(parseGradient("linear-gradient(to right, red, blue)") === null, "a gradient this editor didn't write isn't misread");

console.log("\n-- tone -------------------------------------------------------");
check(backgroundTone("#ffffff") === "light" && backgroundTone("#0b1a33") === "dark", "white is light, navy is dark");
check(backgroundTone(gradientCss(specs[0])) === "dark", "a navy gradient is dark");
check(backgroundTone("") === null, "no background has no tone");

console.log("\n-- the bundle carries a background photo ----------------------");
{
  const { backgroundBundleAssets, resolveBoardBackground } = await import("../lib/bundle/background.ts");
  const photo = { id: "p1", variant: "large", content_hash: "abc123", extension: "webp", content_type: "image/webp", bytes: 900 };
  const backgroundAssets = new Map([["p1", photo]]);
  const docs = [
    { background: { value: "image:p1", src: "/m/p1/editor-preview.webp", dim: 20 } },
    { background: { value: "image:deleted", src: "/m/deleted/x.webp" } },
  ].map((doc) => resolveBoardBackground(doc, backgroundAssets));
  const one = docs[0].background as { src?: string; dim?: number };
  const gone = docs[1].background as { src?: string };
  const cached = backgroundBundleAssets(docs, backgroundAssets, new Set());
  check(one.src === "/m/p1/large-abc123.webp", "the build re-points the photo at its full-screen size", one.src);
  check(one.dim === 20, "and keeps the darkening");
  check(gone.src === undefined, "a deleted photo loses its src, so the TV isn't pointed at a 404");
  check(cached.length === 1 && cached[0].url === one.src, "the photo is in the assets a screen caches before swapping; the deleted one isn't");
}

console.log("\n-- the picture library's import script -------------------------");
{
  const work = mkdtempSync(join(tmpdir(), "backgrounds-"));
  const src = join(work, "src");
  mkdirSync(join(src, "Shabbos"), { recursive: true });
  await sharp({ create: { width: 5000, height: 2800, channels: 3, background: "#1a1f3a" } }).jpeg().toFile(join(src, "Shabbos", "candles_at-dusk.jpg"));
  await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#f4ecd8" } }).png().toFile(join(src, "Shabbos", "Morning light.png"));
  const catalogue = join(work, "library.ts");
  writeFileSync(catalogue, readFileSync(new URL("../lib/background-library.ts", import.meta.url), "utf8").replace(/\/\* BEGIN LIBRARY \*\/[\s\S]*?\/\* END LIBRARY \*\//, "/* BEGIN LIBRARY */ [] /* END LIBRARY */"));
  const run = () =>
    execFileSync("node", [new URL("./add-backgrounds.mjs", import.meta.url).pathname, "--src", src, "--public", join(work, "public"), "--catalogue", catalogue], { encoding: "utf8" });
  run();
  const read = () => JSON.parse(/\/\* BEGIN LIBRARY \*\/([\s\S]*?)\/\* END LIBRARY \*\//.exec(readFileSync(catalogue, "utf8"))![1]);
  const entries = read();
  const dusk = entries.find((e: { name: string }) => e.name === "Candles at dusk");
  const morning = entries.find((e: { name: string }) => e.name === "Morning light");
  check(entries.length === 2 && dusk?.category === "Shabbos", "each picture becomes an entry, named from its file and grouped by its folder");
  check(dusk?.width === 3840 && dusk?.height <= 2160, "a huge original is fitted inside 4K", `${dusk?.width}×${dusk?.height}`);
  check(morning?.width === 1600, "a smaller one is never enlarged", String(morning?.width));
  check(dusk?.tone === "dark" && morning?.tone === "light", "tone is measured from the picture");
  check(/^\/backgrounds\/[a-z0-9-]+-[0-9a-f]{10}\.webp$/.test(dusk?.src ?? ""), "file names carry a content hash", dusk?.src);
  check(readdirSync(join(work, "public")).length === 4, "a picture and a thumbnail each");
  const again = run();
  check(/same\s+Shabbos/.test(again) && read().length === 2, "re-running with nothing changed changes nothing");
}

console.log("\n-- the colour palette ----------------------------------------");
check(PALETTE_COLORS.length >= 50, "at least 50 colours", String(PALETTE_COLORS.length));
check(PALETTE_COLORS.every((color) => /^#[0-9a-f]{6}$/.test(color)), "every colour is a #rrggbb the colour fields store");
check(new Set(PALETTE_COLORS).size === PALETTE_COLORS.length, "no colour appears twice");
check(PALETTE.slice(1).every((family) => family.colors.length === 7), "each family has seven shades");

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
