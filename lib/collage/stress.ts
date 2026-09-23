import type { CollageBox, CollageLayout, CollagePhoto } from "./layout.ts";
import { albumVersion, paginate, type PaginateOptions } from "./paginate.ts";
import { createRng, type Rng } from "./random.ts";

/*
 * Random photo sets and boxes for tuning the engine — shared by the stress test
 * (scripts/test-collage.ts) and the /collage-lab page, so the numbers the lab
 * shows are the numbers the test asserts.
 */

/** Relative weights of each kind of photo in a generated set. */
export type PhotoMix = { portrait: number; landscape: number; square: number; panorama: number; tall: number };

export const MIXES: Record<string, PhotoMix> = {
  mixed: { portrait: 3, landscape: 4, square: 1, panorama: 0.6, tall: 0.4 },
  "all portrait": { portrait: 1, landscape: 0, square: 0, panorama: 0, tall: 0 },
  "all landscape": { portrait: 0, landscape: 1, square: 0, panorama: 0, tall: 0 },
  "all square": { portrait: 0, landscape: 0, square: 1, panorama: 0, tall: 0 },
  "all panoramic": { portrait: 0, landscape: 0, square: 0, panorama: 1, tall: 0 },
  "phone photos": { portrait: 5, landscape: 2, square: 0.5, panorama: 0.2, tall: 0.3 },
};

const RANGES: Record<keyof PhotoMix, [number, number]> = {
  portrait: [0.62, 0.82],
  landscape: [1.25, 1.8],
  square: [0.95, 1.05],
  panorama: [2.4, 4.5],
  tall: [0.28, 0.45],
};

export function randomPhotos(rng: Rng, count: number, mix: PhotoMix): CollagePhoto[] {
  const kinds = Object.keys(RANGES) as (keyof PhotoMix)[];
  const total = kinds.reduce((sum, kind) => sum + mix[kind], 0) || 1;
  return Array.from({ length: count }, (_, i) => {
    let roll = rng() * total;
    let kind = kinds[0];
    for (const k of kinds) {
      roll -= mix[k];
      if (roll <= 0 && mix[k] > 0) {
        kind = k;
        break;
      }
    }
    const [lo, hi] = RANGES[kind];
    const aspect = lo + rng() * (hi - lo);
    return { id: `p${i}`, width: Math.round(1000 * aspect), height: 1000 };
  });
}

/** A box between very tall and very wide, at a board-ish size in design units. */
export function randomBox(rng: Rng): CollageBox {
  const aspect = Math.exp(Math.log(0.45) + rng() * (Math.log(3.2) - Math.log(0.45)));
  const long = 500 + rng() * 1400;
  return aspect >= 1
    ? { width: Math.round(long), height: Math.round(long / aspect) }
    : { width: Math.round(long * aspect), height: Math.round(long) };
}

export type StressResult = {
  cases: number;
  pages: number;
  averageCoverage: number;
  worstCoverage: number;
  slowestPageMs: number;
  averagePageMs: number;
  /** Photos that failed to appear exactly once in their cycle, summed. */
  cycleErrors: number;
  worstCase: { box: CollageBox; photos: CollagePhoto[]; layout: CollageLayout } | null;
};

/**
 * Run `cases` random albums through a full pagination cycle each, and report
 * page coverage and build time. `now` is injected so this stays DOM-free.
 */
export function runStress(input: {
  cases: number;
  seed: number;
  now: () => number;
  options?: Partial<PaginateOptions>;
  mix?: PhotoMix;
}): StressResult {
  const rng = createRng(input.seed);
  const mixNames = Object.keys(MIXES);
  let pages = 0;
  let coverageSum = 0;
  let worst = Infinity;
  let worstCase: StressResult["worstCase"] = null;
  let slowest = 0;
  let timeSum = 0;
  let cycleErrors = 0;

  for (let c = 0; c < input.cases; c += 1) {
    const mix = input.mix ?? MIXES[mixNames[Math.floor(rng() * mixNames.length)]];
    const photos = randomPhotos(rng, 12 + Math.floor(rng() * 30), mix);
    const box = randomBox(rng);
    const seen = new Map<string, number>();

    const cycle = paginate(photos, box, input.options, albumVersion(photos));
    for (;;) {
      const started = input.now();
      const step = cycle.next();
      const elapsed = input.now() - started;
      if (step.done) break;
      const page = step.value;
      pages += 1;
      timeSum += elapsed;
      slowest = Math.max(slowest, elapsed);
      coverageSum += page.layout.coverage;
      for (const photo of page.photos) seen.set(photo.id, (seen.get(photo.id) ?? 0) + 1);
      if (page.layout.coverage < worst) {
        worst = page.layout.coverage;
        worstCase = { box, photos: page.photos, layout: page.layout };
      }
    }
    for (const photo of photos) if (seen.get(photo.id) !== 1) cycleErrors += 1;
  }

  return {
    cases: input.cases,
    pages,
    averageCoverage: pages ? coverageSum / pages : 0,
    worstCoverage: pages ? worst : 0,
    slowestPageMs: slowest,
    averagePageMs: pages ? timeSum / pages : 0,
    cycleErrors,
    worstCase,
  };
}
