import { buildLayout, DEFAULT_LAYOUT_OPTIONS, type CollageBox, type CollageLayout, type CollagePhoto, type LayoutOptions } from "./layout.ts";
import { createRng, hashSeed, shuffled } from "./random.ts";

/*
 * Splitting an album into collage pages, one page at a time.
 *
 * LAZY. A page is built from "the photos not yet shown this cycle", so the
 * caller builds the current page and the one after it, never the whole album.
 * That is also what lets an album change land at the next page boundary: the
 * caller recomputes what remains from the latest album and carries on.
 *
 * HOW MANY PER PAGE. `auto` takes as many as still pass the quality bar — every
 * photo's short side at least the minimum, and the box well covered. The
 * density presets bound that search to a range; `exact` takes N.
 *
 * THE TAIL. Once what's left fits in two pages, the last few pages are planned
 * together (an even split into however many pages keeps the worst one best),
 * so a cycle never ends on one lonely photo and a hard set — panoramas in a
 * tall box — gets page sizes that suit it. `exact` balances its last two pages
 * the same way.
 */

export type CollageDensity = "auto" | "few" | "medium" | "many" | "exact";
export type CollageOrder = "newest" | "album" | "shuffle";

/** Builds one page's layout. The Clean engine by default; the Artsy style
 *  plugs its own in (lib/collage/artsy) and keeps everything else here —
 *  page counts, the tail planning, the seeds. */
export type LayoutEngine = (
  photos: readonly CollagePhoto[],
  box: CollageBox,
  options: PaginateOptions,
  seed: number,
) => CollageLayout;

export type PaginateOptions = LayoutOptions & {
  /** Which layout engine builds the pages. */
  engine?: LayoutEngine;
  /** The page-count ranges for the density presets, when an engine wants
   *  different ones (Artsy pages hold fewer photos). */
  densityRanges?: Partial<Record<Exclude<CollageDensity, "exact">, [number, number]>>;
  density: CollageDensity;
  /** The count for `exact` density. */
  exactCount: number;
  /** The most photos any page may hold. */
  maxPerPage: number;
  /** The coverage a page must reach to count as good in `auto` and the presets. */
  minCoverage: number;
};

export const DEFAULT_PAGINATE_OPTIONS: PaginateOptions = {
  ...DEFAULT_LAYOUT_OPTIONS,
  density: "auto",
  exactCount: 4,
  maxPerPage: 14,
  minCoverage: 0.9,
};

const DENSITY_RANGE: Record<Exclude<CollageDensity, "exact">, [number, number]> = {
  auto: [1, 14],
  few: [2, 4],
  medium: [4, 8],
  many: [8, 14],
};

/** Search effort for the probes that decide a page's count. */
const PROBE_EFFORT = 0.2;

/** How many different page counts the tail planner compares. */
const TAIL_PLANS = 4;

/** The tail planner's probes are few, so they can afford a truer search — a
 *  noisy probe there picks the wrong split for the last pages of a cycle. */
const TAIL_PROBE_EFFORT = 0.7;

/** Extra search effort for the one layout a page actually shows. */
const FULL_EFFORT = 1;

export type CollagePage<T extends CollagePhoto> = {
  photos: T[];
  layout: CollageLayout;
};

/** A stable identity for an album's current contents — part of every page seed. */
export function albumVersion(photos: readonly { id: string }[]): number {
  return hashSeed(...photos.map((photo) => photo.id));
}

/** The seed for one page: album version, page index and box size (rounded). */
export function pageSeed(version: number, pageIndex: number, box: CollageBox): number {
  return hashSeed(version, pageIndex, Math.round(box.width), Math.round(box.height));
}

/**
 * The album in display order. `newest` sorts by `addedAt` descending, stable on
 * the album's own order for ties and for photos with no date; `shuffle` is
 * deterministic per `shuffleSeed` (the caller passes a new one each cycle).
 */
export function orderPhotos<T extends { addedAt?: string | null }>(
  photos: readonly T[],
  order: CollageOrder,
  shuffleSeed = 0,
): T[] {
  if (order === "shuffle") return shuffled(photos, createRng(shuffleSeed));
  if (order === "album") return photos.slice();
  return photos
    .map((photo, index) => ({ photo, index, at: photo.addedAt ? Date.parse(photo.addedAt) : NaN }))
    .sort((p, q) => {
      const pa = Number.isNaN(p.at) ? -Infinity : p.at;
      const qa = Number.isNaN(q.at) ? -Infinity : q.at;
      return qa - pa || p.index - q.index;
    })
    .map((entry) => entry.photo);
}

const cleanEngine: LayoutEngine = (photos, box, options, seed) => buildLayout(photos, box, options, seed);

function countRange(options: PaginateOptions, available: number): [number, number] {
  if (options.density === "exact") {
    const n = Math.max(1, Math.min(options.exactCount, options.maxPerPage, available));
    return [n, n];
  }
  const [lo, hi] = options.densityRanges?.[options.density] ?? DENSITY_RANGE[options.density];
  const top = Math.max(1, Math.min(hi, options.maxPerPage, available));
  return [Math.min(lo, top), top];
}

function passes(layout: CollageLayout, box: CollageBox, options: PaginateOptions): boolean {
  const threshold = options.minShortFraction * Math.min(box.width, box.height);
  return layout.cells.length > 0 && layout.minShortSide >= threshold * (1 - 1e-9) && layout.coverage >= options.minCoverage;
}

/** One number for how good a page is: its coverage, marked down if any photo
 *  falls under the minimum size. Comparable across page counts. */
function quality01(layout: CollageLayout, box: CollageBox, options: PaginateOptions): number {
  if (layout.cells.length === 0) return -1;
  const threshold = options.minShortFraction * Math.min(box.width, box.height);
  return layout.coverage - (layout.minShortSide >= threshold * (1 - 1e-9) ? 0 : 0.25);
}

/**
 * The next page from the photos not yet shown, in order. Takes a prefix of
 * `remaining` — the order is the admin's choice, so it is never reshuffled here.
 */
export function nextPage<T extends CollagePhoto>(
  remaining: readonly T[],
  box: CollageBox,
  options: Partial<PaginateOptions> = {},
  seed = 0,
): CollagePage<T> {
  const opts: PaginateOptions = { ...DEFAULT_PAGINATE_OPTIONS, ...options };
  const m = remaining.length;
  const engine = opts.engine ?? cleanEngine;
  if (m === 0) return { photos: [], layout: engine([], box, opts, seed) };

  const [lo, hi] = countRange(opts, m);
  let count = hi;
  let probe: CollageLayout | null = null;

  if (opts.density === "exact") {
    // No sad last page: if N would leave fewer than half a page behind, split
    // what's left evenly across this page and the next.
    const leftover = m - count;
    if (leftover > 0 && leftover < Math.ceil(count / 2)) count = Math.ceil(m / 2);
  } else {
    const probes = new Map<string, CollageLayout>();
    const probeAt = (from: number, k: number, effort = PROBE_EFFORT) => {
      const key = `${from}:${k}:${effort}`;
      let layout = probes.get(key);
      if (!layout) {
        layout = engine(remaining.slice(from, from + k), box, { ...opts, effort }, hashSeed(seed, from, k));
        probes.set(key, layout);
      }
      return layout;
    };
    const quality = (layout: CollageLayout) => quality01(layout, box, opts);

    // Greedy: as many as still pass the quality bar (the spec's "add photos
    // until another would push quality below the thresholds"), or, if none
    // pass, the best of the range.
    let passed = 0;
    let bestCount = lo;
    let bestQuality = -Infinity;
    for (let k = lo; k <= hi; k += 1) {
      const layout = probeAt(0, k);
      if (passes(layout, box, opts)) passed = k;
      const q = quality(layout);
      if (q > bestQuality) {
        bestQuality = q;
        bestCount = k;
      }
    }
    count = passed > 0 ? passed : bestCount;
    let probeEffort = PROBE_EFFORT;

    if (m <= 2 * hi) {
      // THE TAIL. What's left fits in a few pages, so plan them together: split
      // it EVENLY into p pages, for the few smallest workable p, and keep the
      // plan whose WORST page is best (ties to fewer pages). Never a full page
      // followed by one lonely photo, and a hard set — panoramas in a tall box
      // — gets page sizes that suit it instead of whatever greedy left over.
      // Each later call re-plans the same way over what's left, so the plan
      // holds page to page.
      const fewest = Math.ceil(m / hi);
      const most = Math.min(Math.floor(m / lo), fewest + TAIL_PLANS - 1);
      let planQuality = -Infinity;
      for (let pages = fewest; pages <= most; pages += 1) {
        let worst = Infinity;
        let from = 0;
        let first = 0;
        for (let p = 0; p < pages; p += 1) {
          const size = Math.floor(m / pages) + (p < m % pages ? 1 : 0);
          if (p === 0) first = size;
          worst = Math.min(worst, quality(probeAt(from, size, TAIL_PROBE_EFFORT)));
          from += size;
          if (worst <= planQuality) break;
        }
        if (worst > planQuality + 1e-9) {
          planQuality = worst;
          count = first;
          probeEffort = TAIL_PROBE_EFFORT;
        }
      }
    }
    probe = probeAt(0, count, probeEffort);
  }

  const photos = remaining.slice(0, count);
  const full = engine(photos, box, { ...opts, effort: opts.effort * FULL_EFFORT }, seed);
  // The full search usually beats its own probe; keep whichever scored higher.
  const layout = probe && probe.cells.length === photos.length && probe.score > full.score ? probe : full;
  return { photos, layout };
}

/**
 * Every page of one cycle, lazily. `version` seeds each page (see `pageSeed`).
 * For tests and the lab — the display drives `nextPage` itself so it can pick
 * up album changes between pages.
 */
export function* paginate<T extends CollagePhoto>(
  photos: readonly T[],
  box: CollageBox,
  options: Partial<PaginateOptions> = {},
  version = albumVersion(photos),
): Generator<CollagePage<T> & { index: number }> {
  let rest = photos.slice();
  let index = 0;
  while (rest.length > 0) {
    const page = nextPage(rest, box, options, pageSeed(version, index, box));
    if (page.photos.length === 0) return;
    yield { ...page, index };
    rest = rest.slice(page.photos.length);
    index += 1;
  }
}
