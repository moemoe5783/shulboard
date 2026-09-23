/**
 * lib/board-background.ts and lib/board-palette.ts — the background value
 * format, the gradient round trip the editor relies on, tone detection (which
 * decides whether a board's text flips to light), and the library itself.
 * scripts/test-backgrounds-browser.mjs checks the presets are valid CSS.
 */

import {
  BACKGROUND_PRESETS,
  backgroundCss,
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
check(backgroundKind("preset:midnight") === "preset" && (backgroundCss("preset:midnight") ?? "").includes("gradient"), "a preset resolves to its CSS");
check(backgroundCss("preset:no-such-thing") === undefined, "an unknown preset draws nothing rather than garbage");

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

console.log("\n-- the library ------------------------------------------------");
const ids = BACKGROUND_PRESETS.map((preset) => preset.id);
check(BACKGROUND_PRESETS.length >= 50 && BACKGROUND_PRESETS.length <= 100, "between 50 and 100 presets", String(BACKGROUND_PRESETS.length));
check(new Set(ids).size === ids.length, "every preset id is unique");
check(BACKGROUND_PRESETS.every((preset) => /^[a-z0-9-]+$/.test(preset.id) && preset.name && preset.css), "ids are slugs, and each has a name and CSS");
check(
  BACKGROUND_PRESETS.every((preset) => preset.tone === "light" || preset.tone === "dark"),
  "every preset says whether it's light or dark, so text can follow",
);

console.log("\n-- the colour palette ----------------------------------------");
check(PALETTE_COLORS.length >= 50, "at least 50 colours", String(PALETTE_COLORS.length));
check(PALETTE_COLORS.every((color) => /^#[0-9a-f]{6}$/.test(color)), "every colour is a #rrggbb the colour fields store");
check(new Set(PALETTE_COLORS).size === PALETTE_COLORS.length, "no colour appears twice");
check(PALETTE.slice(1).every((family) => family.colors.length === 7), "each family has seven shades");

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
