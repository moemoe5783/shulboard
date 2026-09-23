/**
 * lib/media/collage.ts — the collage template/matching, driven with no DOM.
 *
 * The rules under test:
 *   1. The count is clamped to the album, the request, and the 6-frame library.
 *   2. Every chosen photo lands in exactly one frame.
 *   3. Matching is monotonic: a wider photo never lands in a narrower frame than
 *      a less-wide photo does (the whole point — a portrait in a wide frame
 *      crops badly).
 *   4. A layout variant steps to a different template when one exists.
 */

import { collageCount, layoutCollage } from "../lib/media/collage.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | number = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}

console.log("\n-- rule 1: count is clamped --------------------------------");
check(collageCount(4, 10) === 4, "request under the cap and the album is honoured", collageCount(4, 10));
check(collageCount(4, 2) === 2, "clamped to what the album actually has", collageCount(4, 2));
check(collageCount(8, 10) === 6, "clamped to the six-frame library ceiling", collageCount(8, 10));
check(collageCount(0, 5) === 1, "never fewer than one", collageCount(0, 5));

console.log("\n-- rule 2: every photo placed once -------------------------");
{
  const placements = layoutCollage({ count: 5, photoAspects: [1.5, 0.6, 1, 2, 0.8], boxAspect: 16 / 9 });
  check(placements.length === 5, "one placement per photo", placements.length);
  const indices = new Set(placements.map((p) => p.photoIndex));
  check(indices.size === 5 && [...indices].every((i) => i >= 0 && i < 5), "each photo used exactly once");
}

console.log("\n-- rule 3: wider photos get wider frames -------------------");
{
  const boxAspect = 16 / 9;
  const photoAspects = [2.2, 0.5, 1.0, 1.6]; // very wide, tall, square, landscape
  const placements = layoutCollage({ count: 4, photoAspects, boxAspect });
  const pairs = placements
    .map((p) => ({
      frameAspect: (p.frame.w / p.frame.h) * boxAspect,
      photoAspect: photoAspects[p.photoIndex],
    }))
    .sort((a, b) => a.frameAspect - b.frameAspect);
  let monotone = true;
  for (let i = 1; i < pairs.length; i += 1) {
    if (pairs[i].photoAspect < pairs[i - 1].photoAspect - 1e-9) monotone = false;
  }
  check(monotone, "sorting frames by width sorts the photos by width too", pairs.map((p) => p.photoAspect.toFixed(1)).join(","));
}

console.log("\n-- rule 4: variants step through templates -----------------");
{
  const args = { count: 2, photoAspects: [1.5, 0.7], boxAspect: 1 };
  const a = layoutCollage({ ...args, variant: 0 });
  const b = layoutCollage({ ...args, variant: 1 });
  // count=2 has two templates (side-by-side, stacked); the variants must differ
  // in at least one frame's shape.
  const shape = (placements: typeof a) => placements.map((p) => `${p.frame.w}x${p.frame.h}`).sort().join("|");
  check(shape(a) !== shape(b), "variant 1 is a different template than variant 0", `${shape(a)} vs ${shape(b)}`);
  const wrap = layoutCollage({ ...args, variant: 2 });
  check(shape(wrap) === shape(a), "and the variant index wraps", shape(wrap));
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
