import type { CollageBox } from "../layout.ts";
import { albumVersion, paginate, type CollageDensity } from "../paginate.ts";
import { createRng } from "../random.ts";
import { MIXES, randomBox, randomPhotos } from "../stress.ts";
import { FRAME_STYLES } from "./frames.ts";
import {
  ARTSY_PAGINATION,
  artsyEngine,
  artsyViolations,
  DEFAULT_ARTSY_TUNING,
  type ArtsyLayout,
  type ArtsyOptions,
  type ArtsyOverlap,
  type ArtsyTilt,
  type ArtsyTuning,
} from "./layout.ts";

/*
 * The Artsy stress test (spec §10, §11): random photo mixes, boxes and
 * settings through full pagination cycles, checking every page against the
 * hard rules independently of the engine's own check. Shared by
 * scripts/test-collage-artsy.ts and the /collage-lab page, so the lab shows
 * the numbers the test asserts.
 */

export type ArtsyStressResult = {
  cases: number;
  pages: number;
  /** Images touched by anything, items out of the box, loose fasteners. */
  imageViolations: number;
  outOfBox: number;
  fastenerViolations: number;
  /** Pages whose frame overlap went past the cap (or any, with Overlap: none). */
  overlapViolations: number;
  /** Photos that didn't appear exactly once in their cycle. */
  cycleErrors: number;
  averageCoverage: number;
  worstCoverage: number;
  worstHole: number;
  averageOverlapPairs: number;
  slowestPageMs: number;
  p99PageMs: number;
  averagePageMs: number;
  fallbackPages: number;
  worstCase: { box: CollageBox; layout: ArtsyLayout; options: Partial<ArtsyOptions> } | null;
};

const TILTS: ArtsyTilt[] = ["none", "subtle", "playful"];
const OVERLAPS: ArtsyOverlap[] = ["none", "slight"];
const DENSITIES: CollageDensity[] = ["auto", "few", "medium", "many"];

export function runArtsyStress(input: {
  cases: number;
  seed: number;
  now: () => number;
  tuning?: Partial<ArtsyTuning>;
  options?: Partial<ArtsyOptions>;
}): ArtsyStressResult {
  const rng = createRng(input.seed);
  const mixNames = Object.keys(MIXES);
  const tuning = { ...DEFAULT_ARTSY_TUNING, ...input.tuning };
  const result: ArtsyStressResult = {
    cases: input.cases,
    pages: 0,
    imageViolations: 0,
    outOfBox: 0,
    fastenerViolations: 0,
    overlapViolations: 0,
    cycleErrors: 0,
    averageCoverage: 0,
    worstCoverage: Infinity,
    worstHole: 0,
    averageOverlapPairs: 0,
    slowestPageMs: 0,
    p99PageMs: 0,
    averagePageMs: 0,
    fallbackPages: 0,
    worstCase: null,
  };
  const times: number[] = [];
  let coverageSum = 0;
  let overlapSum = 0;

  for (let c = 0; c < input.cases; c += 1) {
    const photos = randomPhotos(rng, 6 + Math.floor(rng() * 22), MIXES[mixNames[Math.floor(rng() * mixNames.length)]]);
    const box = randomBox(rng);
    const options: Partial<ArtsyOptions> = {
      frame: FRAME_STYLES[Math.floor(rng() * FRAME_STYLES.length)],
      tilt: TILTS[Math.floor(rng() * TILTS.length)],
      overlap: OVERLAPS[Math.floor(rng() * OVERLAPS.length)],
      fasteners: rng() < 0.8,
      ...input.options,
      tuning,
    };
    const density = DENSITIES[Math.floor(rng() * DENSITIES.length)];
    const seen = new Map<string, number>();
    const cycle = paginate(photos, box, { ...ARTSY_PAGINATION, engine: artsyEngine(options), density }, albumVersion(photos));
    for (;;) {
      const started = input.now();
      const step = cycle.next();
      const elapsed = input.now() - started;
      if (step.done) break;
      const page = step.value;
      const layout = page.layout as ArtsyLayout;
      result.pages += 1;
      times.push(elapsed);
      result.slowestPageMs = Math.max(result.slowestPageMs, elapsed);
      coverageSum += layout.coverage;
      overlapSum += layout.overlapPairs;
      if (layout.fallback) result.fallbackPages += 1;
      result.worstHole = Math.max(result.worstHole, layout.hole);
      const v = artsyViolations(layout, box, tuning.shadowMargin);
      result.imageViolations += v.images.length;
      result.outOfBox += v.outOfBox.length;
      result.fastenerViolations += v.fasteners.length;
      const overlapBroken = options.overlap === "none" ? layout.overlapPairs > 0 : layout.maxOverlapOfCap > 1 + 1e-6;
      if (overlapBroken) result.overlapViolations += 1;
      if (layout.items.length !== page.photos.length) result.imageViolations += 1;
      for (const photo of page.photos) seen.set(photo.id, (seen.get(photo.id) ?? 0) + 1);
      if (layout.coverage < result.worstCoverage) {
        result.worstCoverage = layout.coverage;
        result.worstCase = { box, layout, options };
      }
    }
    for (const photo of photos) if (seen.get(photo.id) !== 1) result.cycleErrors += 1;
  }

  const n = Math.max(1, result.pages);
  result.averageCoverage = coverageSum / n;
  result.averageOverlapPairs = overlapSum / n;
  result.averagePageMs = times.reduce((sum, t) => sum + t, 0) / n;
  times.sort((a, b) => a - b);
  result.p99PageMs = times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.99))] : 0;
  if (!Number.isFinite(result.worstCoverage)) result.worstCoverage = 0;
  return result;
}
