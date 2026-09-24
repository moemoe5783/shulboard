/*
 * The Artsy collage's acceptance criteria (the Artsy spec, §11), run in Node:
 * zero image violations over 1,000 random albums, boxes and settings; every
 * item inside the box; frame overlap within its cap; every photo once per
 * cycle; the same layout for the same inputs; average coverage at least 70%.
 * Timing is reported, not asserted — a shared CI machine isn't a TV.
 */
import { artsyViolations, buildArtsyLayout, cosSin, runArtsyStress } from "../lib/collage/artsy/index.ts";
import { createRng } from "../lib/collage/random.ts";
import { MIXES, randomBox, randomPhotos } from "../lib/collage/stress.ts";

const results: boolean[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push(ok);
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

// Trig that matches Math to double precision, over the tilt range.
let worstTrig = 0;
for (let deg = -15; deg <= 15; deg += 0.01) {
  const rad = (deg * Math.PI) / 180;
  const { c, s } = cosSin(rad);
  worstTrig = Math.max(worstTrig, Math.abs(c - Math.cos(rad)), Math.abs(s - Math.sin(rad)));
}
check(worstTrig < 1e-15, "the engine's own cos and sin match Math's to double precision", worstTrig.toExponential(1));

// Determinism: the same inputs give the identical layout, twice over.
const rng = createRng(11);
let identical = true;
for (let c = 0; c < 40; c += 1) {
  const photos = randomPhotos(rng, 3 + (c % 8), MIXES.mixed);
  const box = randomBox(rng);
  const options = { frame: (["polaroid", "wood", "taped", "mixed"] as const)[c % 4], tilt: (["subtle", "playful"] as const)[c % 2] };
  const a = JSON.stringify(buildArtsyLayout(photos, box, options, c));
  const b = JSON.stringify(buildArtsyLayout(photos, box, options, c));
  if (a !== b) identical = false;
}
check(identical, "the same album, box, settings and page give the identical layout");

// A Polaroid keeps its photo's real shape, and its bottom strip is the deep one.
{
  const layout = buildArtsyLayout([{ id: "tall", width: 600, height: 1000 }], { width: 1000, height: 1000 }, { frame: "polaroid", tilt: "none" });
  const item = layout.items[0];
  const aspect = item.image.w / item.image.h;
  const bottom = item.outer.h - item.image.y - item.image.h;
  check(Math.abs(aspect - 0.6) < 1e-4 && bottom > item.image.y * 3, "a portrait stays a portrait inside its Polaroid, with the deep bottom strip",
    `${aspect.toFixed(3)}, top ${item.image.y.toFixed(1)}, bottom ${bottom.toFixed(1)}`);
  check(artsyViolations(layout, { width: 1000, height: 1000 }).images.length === 0, "a single print breaks no rule");
}

// Tilt rules: about a fifth straight, neighbours never alike, both directions used.
{
  const photos = randomPhotos(createRng(5), 8, MIXES.mixed);
  const layout = buildArtsyLayout(photos, { width: 1600, height: 900 }, { tilt: "playful" }, 3);
  const angles = layout.items.map((item) => item.rotation);
  const straight = angles.filter((a) => Math.abs(a) < 1.5).length;
  const left = angles.filter((a) => a < -0.1).length;
  const right = angles.filter((a) => a > 0.1).length;
  check(straight >= 1 && straight <= 3 && left >= 2 && right >= 2 && angles.every((a) => Math.abs(a) <= 10.0001),
    "playful tilts: a few nearly straight, leaning both ways, never past 10°", angles.map((a) => a.toFixed(1)).join(" "));
}

const started = performance.now();
const stress = runArtsyStress({ cases: 1000, seed: 42, now: () => performance.now() });
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`\n  1,000 albums, ${stress.pages} pages in ${seconds}s`);
check(stress.imageViolations === 0, "no photo's image is covered by anything, on any page", `${stress.imageViolations}`);
check(stress.outOfBox === 0, "every print's rotated outline stays inside the box", `${stress.outOfBox}`);
check(stress.fastenerViolations === 0, "every tape strip and pin sits on its own frame, above the photo", `${stress.fastenerViolations}`);
check(stress.overlapViolations === 0, "frame-on-frame overlap never passes its cap (or happens at all with Overlap: none)", `${stress.overlapViolations}`);
check(stress.cycleErrors === 0, "every photo appears exactly once per cycle", `${stress.cycleErrors}`);
check(stress.averageCoverage >= 0.7, "prints cover at least 70% of the box on average", stress.averageCoverage.toFixed(3));
check(stress.worstHole <= 0.3, "no page leaves a glaring empty hole", `largest empty square ${(stress.worstHole * 100).toFixed(1)}% of the box`);
console.log(
  `  build time: average ${stress.averagePageMs.toFixed(1)}ms, p99 ${stress.p99PageMs.toFixed(1)}ms, slowest ${stress.slowestPageMs.toFixed(1)}ms;` +
    ` ${stress.averageOverlapPairs.toFixed(2)} overlapping pairs a page; ${stress.fallbackPages} pages used the in-cell fallback; worst coverage ${stress.worstCoverage.toFixed(3)}`,
);

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
