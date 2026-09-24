/*
 * The photo and flyer presets (lib/editor/size-presets.ts): which shape a box
 * is, and reshaping one to a preset.
 */
import { describeRatio, fitToPreset, matchPresets, orientationOf, SIZE_PRESETS, RATIO_TOLERANCE } from "../lib/editor/size-presets.ts";

const results: boolean[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push(ok);
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}
const labels = (w: number, h: number) => matchPresets(w, h).map((p) => p.label).join(", ");

check(labels(600, 900) === "4 × 6 in photo, 24 × 36 in poster", "a 600 × 900 box is a 4 × 6 photo, and a 24 × 36 poster", labels(600, 900));
check(labels(900, 600) === labels(600, 900), "either way up");
check(labels(850, 1100) === "Letter flyer, 8.5 × 11 in", "850 × 1100 is a letter flyer", labels(850, 1100));
check(labels(1920, 1080) === "Widescreen, 16:9", "the whole canvas is 16:9", labels(1920, 1080));
check(labels(500, 500) === "Square", "a square", labels(500, 500));
check(labels(601, 900) !== "", "a pixel off at this size still counts", labels(601, 900));
check(labels(600, 950) === "", "stretched by an edge, it's no preset any more", labels(600, 950));
check(labels(714.3, 1000) === "5 × 7 in photo" && labels(707.1, 1000) === "A4, A3 or A5", "5 × 7 and A4 are told apart", `${labels(714.3, 1000)} / ${labels(707.1, 1000)}`);

// No two presets of different shapes sit inside each other's tolerance.
let tooClose = "";
for (const a of SIZE_PRESETS) for (const b of SIZE_PRESETS) {
  const ra = a.long / a.short, rb = b.long / b.short;
  if (a !== b && ra !== rb && Math.abs(ra / rb - 1) <= RATIO_TOLERANCE * 2) tooClose = `${a.label} / ${b.label}`;
}
check(tooClose === "", "every preset shape is distinguishable from every other", tooClose);

const canvas = { width: 1920, height: 1080 };
const letter = SIZE_PRESETS.find((p) => p.id === "letter")!;
const fitted = fitToPreset({ x: 100, y: 100, w: 600, h: 600 }, letter, "portrait", canvas);
check(labels(fitted.w, fitted.h) === "Letter flyer, 8.5 × 11 in" && orientationOf(fitted.w, fitted.h) === "portrait",
  "choosing letter, portrait, reshapes the box to it", `${fitted.w.toFixed(1)} × ${fitted.h.toFixed(1)}`);
check(Math.abs(fitted.w * fitted.h - 360000) < 1 && Math.abs(fitted.x + fitted.w / 2 - 400) < 0.01,
  "keeping its area and its centre");
const big = fitToPreset({ x: 0, y: 0, w: 1900, h: 1000 }, letter, "portrait", canvas);
check(big.h <= 1080 && big.y >= 0 && labels(big.w, big.h) !== "", "a big box is scaled down to stay on the canvas", `${big.w.toFixed(0)} × ${big.h.toFixed(0)}`);
check(describeRatio(600, 900) === "2:3" && describeRatio(1000, 777) === "1.29:1", "shapes read as people write them",
  `${describeRatio(600, 900)}, ${describeRatio(1000, 777)}`);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
