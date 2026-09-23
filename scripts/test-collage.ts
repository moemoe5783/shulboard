/**
 * lib/collage — the slicing-tree layout engine and its pagination, driven with
 * no DOM. These are the collage spec's acceptance criteria that don't need a
 * browser:
 *
 *   1. No photo is ever cropped or distorted: every cell has its photo's aspect.
 *   2. Gaps are uniform: no two photos closer than the gap, and every photo has
 *      a neighbour at exactly the gap.
 *   3. Across a 1,000-case stress run, average coverage ≥ 90% and worst ≥ 80%
 *      for every mix except all-panoramic, which is reported against its own
 *      floor (see the note at that check — some counts of 3:1 photos cannot
 *      fill a square box uncropped, whatever the arrangement).
 *   4. Same album, box and settings → identical layout, every time.
 *   5. Every photo appears exactly once per cycle.
 *   9. Page build time (here, on a dev machine — the spec's 50ms is for a
 *      low-end display, which this number is the headroom for).
 */

import { buildLayout, nextPage, orderPhotos, paginate, albumVersion, type CollageLayout, type CollagePhoto } from "../lib/collage/index.ts";
import { createRng } from "../lib/collage/random.ts";
import { MIXES, randomBox, randomPhotos, runStress } from "../lib/collage/stress.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | number = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail === "" ? "" : ` — ${detail}`}`);
}

const photo = (id: string, aspect: number): CollagePhoto => ({ id, width: Math.round(1000 * aspect), height: 1000 });

/** Largest deviation of any cell's aspect from its photo's, as a ratio. */
function distortion(photos: CollagePhoto[], layout: CollageLayout): number {
  let worst = 0;
  for (const cell of layout.cells) {
    const p = photos.find((x) => x.id === cell.photoId)!;
    worst = Math.max(worst, Math.abs(cell.w / cell.h / (p.width / p.height) - 1));
  }
  return worst;
}

/** The distance between two rectangles (0 if they touch or overlap). */
function separation(a: CollageLayout["cells"][number], b: CollageLayout["cells"][number]): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
  return Math.hypot(dx, dy);
}

/** [closest any pair gets, farthest any photo is from its nearest neighbour]. */
function gapExtremes(layout: CollageLayout): [number, number] {
  let closest = Infinity;
  let loneliest = 0;
  for (const a of layout.cells) {
    let nearest = Infinity;
    for (const b of layout.cells) {
      if (a === b) continue;
      const d = separation(a, b);
      closest = Math.min(closest, d);
      nearest = Math.min(nearest, d);
    }
    loneliest = Math.max(loneliest, nearest);
  }
  return [closest, loneliest];
}

console.log("\n-- rule 1 & 2: never distorted, gaps uniform ----------------");
{
  const rng = createRng(42);
  let worstDistortion = 0;
  let worstClose = Infinity;
  let worstLonely = 0;
  let outOfBox = 0;
  const gap = 8;
  for (let c = 0; c < 400; c += 1) {
    const names = Object.keys(MIXES);
    const photos = randomPhotos(rng, 2 + Math.floor(rng() * 13), MIXES[names[c % names.length]]);
    const box = randomBox(rng);
    const layout = buildLayout(photos, box, { gap }, c);
    worstDistortion = Math.max(worstDistortion, distortion(photos, layout));
    const [close, lonely] = gapExtremes(layout);
    worstClose = Math.min(worstClose, close);
    worstLonely = Math.max(worstLonely, lonely);
    for (const cell of layout.cells) {
      if (cell.x < -1e-6 || cell.y < -1e-6 || cell.x + cell.w > box.width + 1e-6 || cell.y + cell.h > box.height + 1e-6) outOfBox += 1;
    }
  }
  check(worstDistortion < 1e-9, "every cell has exactly its photo's aspect ratio (no crop, no stretch)", worstDistortion.toExponential(2));
  check(worstClose >= gap - 1e-6, "no two photos are ever closer than the gap", `${worstClose.toFixed(4)} ≥ ${gap}`);
  check(worstLonely <= gap + 1, "and every photo has a neighbour at the gap, within 1px", `${worstLonely.toFixed(4)} ≤ ${gap + 1}`);
  check(outOfBox === 0, "every photo sits inside the box", `${outOfBox} outside`);
}

console.log("\n-- edge cases --------------------------------------------------");
{
  const box = { width: 1600, height: 900 };
  const empty = buildLayout([], box);
  check(empty.cells.length === 0 && empty.coverage === 0, "no photos is an empty layout, not an error");

  const one = buildLayout([photo("a", 0.75)], box);
  const cell = one.cells[0];
  check(Math.abs(cell.h - 900) < 1e-6 && Math.abs(cell.x + cell.w / 2 - 800) < 1e-6, "one photo fits the box and is centred", `${cell.w.toFixed(0)}×${cell.h.toFixed(0)} at x ${cell.x.toFixed(0)}`);

  const pano = buildLayout([photo("p", 4.5), photo("a", 1.5), photo("b", 1.4)], { width: 1200, height: 900 });
  const p = pano.cells.find((c) => c.photoId === "p")!;
  check(p.w > 1200 * 0.6, "a panorama is pushed to span the box width", `${((p.w / 1200) * 100).toFixed(0)}% wide`);

  const tall = buildLayout([photo("t", 0.3), photo("a", 1.2), photo("b", 1.3)], { width: 1200, height: 900 });
  const t = tall.cells.find((c) => c.photoId === "t")!;
  check(t.h > 900 * 0.6, "a very tall photo is pushed to span the box height", `${((t.h / 900) * 100).toFixed(0)}% tall`);

  const tiny = buildLayout(Array.from({ length: 14 }, (_, i) => photo(`x${i}`, 1)), { width: 60, height: 40 }, { gap: 8 });
  check(tiny.cells.length === 0 || tiny.cells.every((c) => c.w > 0 && c.h > 0), "a box too small for its gaps never yields a negative cell");
}

console.log("\n-- rule 4: deterministic ---------------------------------------");
{
  const rng = createRng(7);
  let mismatches = 0;
  for (let c = 0; c < 50; c += 1) {
    const photos = randomPhotos(rng, 3 + (c % 12), MIXES.mixed);
    const box = randomBox(rng);
    const a = JSON.stringify(buildLayout(photos, box, {}, 1234 + c));
    const b = JSON.stringify(buildLayout(photos.map((x) => ({ ...x })), { ...box }, {}, 1234 + c));
    if (a !== b) mismatches += 1;
  }
  check(mismatches === 0, "the same photos, box and seed give an identical layout", `${mismatches} of 50 differed`);

  const photos = randomPhotos(createRng(3), 30, MIXES.mixed);
  const box = { width: 1920, height: 1080 };
  const first = JSON.stringify([...paginate(photos, box)].map((p) => p.layout));
  const second = JSON.stringify([...paginate(photos, box)].map((p) => p.layout));
  check(first === second, "and a whole cycle of pages repeats exactly");
}

console.log("\n-- rule 5 & pagination ---------------------------------------");
{
  const rng = createRng(5);
  let errors = 0;
  let lonely = 0;
  for (let c = 0; c < 100; c += 1) {
    const photos = randomPhotos(rng, 5 + Math.floor(rng() * 40), MIXES.mixed);
    const pages = [...paginate(photos, randomBox(rng))];
    const ids = pages.flatMap((p) => p.photos.map((x) => x.id));
    if (ids.length !== photos.length || new Set(ids).size !== photos.length) errors += 1;
    if (pages.length > 1 && pages[pages.length - 1].photos.length === 1) lonely += 1;
  }
  check(errors === 0, "every photo appears exactly once per cycle", `${errors} of 100 albums wrong`);
  check(lonely === 0, "a cycle never ends on a single leftover photo", `${lonely} of 100`);

  const photos = Array.from({ length: 11 }, (_, i) => photo(`e${i}`, 1.4));
  const exact = [...paginate(photos, { width: 1600, height: 900 }, { density: "exact", exactCount: 4 })].map((p) => p.photos.length);
  check(exact.join(",") === "4,4,3" || exact.join(",") === "4,3,4", "exact density takes N per page, balancing the last", exact.join(","));
  const five = [...paginate(photos.slice(0, 9), { width: 1600, height: 900 }, { density: "exact", exactCount: 8 })].map((p) => p.photos.length);
  check(five.join(",") === "5,4", "…and splits a lonely remainder evenly rather than 8 then 1", five.join(","));

  for (const [density, [lo, hi]] of [["few", [2, 4]], ["medium", [4, 8]], ["many", [8, 14]]] as const) {
    const sizes = [...paginate(randomPhotos(createRng(8), 60, MIXES.mixed), { width: 1920, height: 1080 }, { density })].map((p) => p.photos.length);
    const inRange = sizes.slice(0, -2).every((n) => n >= lo && n <= hi);
    check(inRange, `${density} density keeps pages within ${lo}–${hi}`, sizes.join(","));
  }

  const dated = [
    { ...photo("old", 1), addedAt: "2026-01-01T00:00:00Z" },
    { ...photo("new", 1), addedAt: "2026-06-01T00:00:00Z" },
    { ...photo("mid", 1), addedAt: "2026-03-01T00:00:00Z" },
  ];
  check(orderPhotos(dated, "newest").map((p) => p.id).join(",") === "new,mid,old", "newest-first sorts by the date added");
  check(orderPhotos(dated, "album").map((p) => p.id).join(",") === "old,new,mid", "album order keeps the album's own order");
  const s1 = orderPhotos(dated, "shuffle", 1).map((p) => p.id).join(",");
  check(s1 === orderPhotos(dated, "shuffle", 1).map((p) => p.id).join(","), "shuffle is deterministic per cycle seed");

  const remaining = randomPhotos(createRng(2), 20, MIXES.mixed);
  const page = nextPage(remaining, { width: 1920, height: 1080 });
  check(page.photos.every((p, i) => p.id === remaining[i].id), "a page takes photos in order — the admin's order is never reshuffled");
  check(albumVersion(remaining) !== albumVersion(remaining.slice(1)), "the album version changes when the album does");
}

console.log("\n-- rule 3 & 9: the stress run ----------------------------------");
{
  const now = () => performance.now();
  // Warm the JIT first, so the timing below is the steady state a screen
  // running for months actually sees rather than its first second.
  runStress({ cases: 30, seed: 999, now });

  const all = runStress({ cases: 1000, seed: 1, now });
  console.log(
    `  1000 albums, ${all.pages} pages: average ${(all.averageCoverage * 100).toFixed(1)}%, worst ${(all.worstCoverage * 100).toFixed(1)}%, ` +
      `build ${all.averagePageMs.toFixed(2)}ms average / ${all.slowestPageMs.toFixed(1)}ms slowest`,
  );
  check(all.averageCoverage >= 0.9, "average coverage across the stress run is at least 90%", `${(all.averageCoverage * 100).toFixed(1)}%`);
  check(all.cycleErrors === 0, "every photo shown once per cycle in every stress album", all.cycleErrors);
  check(all.slowestPageMs < 50, "no page takes 50ms to build", `${all.slowestPageMs.toFixed(1)}ms`);

  for (const [name, mix] of Object.entries(MIXES)) {
    const run = runStress({ cases: 170, seed: 17, now, mix });
    const floor = name === "all panoramic" ? 0.7 : 0.8;
    check(
      run.averageCoverage >= 0.9 && run.worstCoverage >= floor,
      `${name}: average ≥ 90%, worst ≥ ${floor * 100}%`,
      `average ${(run.averageCoverage * 100).toFixed(1)}%, worst ${(run.worstCoverage * 100).toFixed(1)}%`,
    );
  }
  // WHY ALL-PANORAMIC GETS ITS OWN FLOOR: four 3:1 photos in a square box can
  // only stack (a 0.75 composite) or pair up (1.5 per column, 3.0 side by
  // side) — 75% is the best any uncropped arrangement reaches, and an album
  // whose size forces a page of four hits it. Everything else meets 80%.
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
