import {
  albumVersion,
  hashSeed,
  nextPage,
  orderPhotos,
  pageSeed,
  type CollageBox,
  type CollagePhoto,
} from "@/lib/collage";
import { ARTSY_PAGINATION, artsyEngine, type ArtsyLayout, type Fastener, type ItemFrameStyle } from "@/lib/collage/artsy";
import type { BoardFiles } from "@/lib/board-files";
import type { BoardPhoto, BoardPhotoVariant } from "@/lib/media/album-photos";
import { photoVariants, pickVariant, readyVariant } from "@/lib/media/variant-choice";
import type { CollageConfig } from "./manifest";
import { enterOffset, transitionTotal } from "./transitions";

/*
 * The collage's cycle — which page is on screen, which is next, and when to
 * swap — kept outside React as a tiny store the Renderer subscribes to.
 *
 * WHAT IT GUARANTEES (the collage spec, §4):
 *  - Every photo once per cycle: page N is built from the album's photos not on
 *    pages 0..N-1, so a cycle ends exactly when they're used up.
 *  - THE WHOLE ALBUM, ALWAYS. Pages are planned against the full album, never
 *    the part of it a screen happens to hold, so every screen shows identical
 *    pages — and, planned ahead through the cycle, every file each page will
 *    use is known up front. Those are declared to the board (`files.want`,
 *    lib/board-assets.tsx) in the order they'll be shown, which is what the
 *    display downloads.
 *  - A PAGE SHOWS ONLY WHEN ALL OF IT IS HERE. At a boundary, if the next page
 *    has a photo whose file isn't on the device yet, the current page stays.
 *    Once it has been up for three intervals, the collage moves on to the next
 *    page that is fully here instead of holding one page forever. Never a
 *    grey hole where a photo should be, including offline.
 *  - Album changes land at the next page boundary. The page on screen is never
 *    re-laid out; the pages after it are re-planned from the latest album, so a
 *    new photo appears within the cycle and a deleted one simply isn't picked.
 *  - Deterministic: page N of cycle C for the same album, box and settings is
 *    the same layout in the editor and on every screen (lib/collage's seeds).
 *
 * Layout-shaping inputs changing — the box, the gap, density, order, album
 * choice — restart from the first page, the same as a reload would. That is
 * what gives the editor its live preview while a box is being resized.
 */

/**
 * An Artsy layout as the cells the Renderer draws (./ArtsyLayer.tsx): each
 * print's outer rect in percentages of the box, and its paper, photo and
 * fasteners in percentages of the print. `source` picks each photo's file.
 * Shared with the collage lab, so the lab draws exactly what a screen does.
 */
export function artsyCells(
  layout: ArtsyLayout,
  box: CollageBox,
  source: (item: ArtsyLayout["items"][number]) => {
    src: string;
    alt: string;
    variants?: readonly BoardPhotoVariant[];
    needed?: number;
  },
): PlannedCell[] {
  const order = layout.items.map((item, i) => ({ i, z: item.zIndex })).sort((a, b) => a.z - b.z || a.i - b.i);
  const zOrder = new Array<number>(layout.items.length);
  order.forEach((entry, rank) => {
    zOrder[entry.i] = rank;
  });
  const pct = (rect: { x: number; y: number; w: number; h: number }, within: { w: number; h: number }): PctRect => ({
    left: (rect.x / within.w) * 100,
    top: (rect.y / within.h) * 100,
    width: (rect.w / within.w) * 100,
    height: (rect.h / within.h) * 100,
  });
  return layout.items.map((item, i) => ({
    id: item.photoId,
    variants: [],
    needed: 0,
    left: ((item.cx - item.outer.w / 2) / box.width) * 100,
    top: ((item.cy - item.outer.h / 2) / box.height) * 100,
    width: (item.outer.w / box.width) * 100,
    height: (item.outer.h / box.height) * 100,
    ...source(item),
    artsy: {
      style: item.style,
      rotation: item.rotation,
      zIndex: item.zIndex,
      zOrder: zOrder[i],
      image: pct(item.image, item.outer),
      paper: pct(item.paper, item.outer),
      frameUnits: item.spec.frame * Math.min(item.image.w, item.image.h),
      fasteners: item.fasteners.map((f) => ({
        ...pct({ x: f.x, y: f.y, w: f.w, h: f.h }, item.outer),
        kind: f.kind,
        angle: f.angle,
        variant: f.variant,
      })),
      variation: item.variation,
      hero: item.hero,
    },
  }));
}

/** A photo the engine can place: it has a size, so it has an aspect ratio. */
type EnginePhoto = CollagePhoto & { addedAt: string | null; photo: BoardPhoto; variants: BoardPhotoVariant[] };

/** A rectangle as percentages of whatever contains it. */
export type PctRect = { left: number; top: number; width: number; height: number };

/** An Artsy print's dressing, laid out by lib/collage/artsy. Every rect is a
 *  percentage of the print's own outer rect, so it scales with the board. */
export type PlannedArtsy = {
  style: ItemFrameStyle;
  rotation: number;
  zIndex: number;
  /** Where in the stacking order it sits, from the bottom — what Deal and
   *  Shuffle play in. */
  zOrder: number;
  image: PctRect;
  paper: PctRect;
  /** For wood and gallery frames: the frame band's thickness, and the mat
   *  inside it, in board design units. */
  frameUnits: number;
  fasteners: (PctRect & { kind: Fastener["kind"]; angle: number; variant: number })[];
  variation: { tint: number; tone: number; grain: number };
  hero: boolean;
};

export type PlannedCell = {
  id: string;
  /** Percentages of the collage box. For an Artsy print, its unrotated outer
   *  rect; the tilt is `artsy.rotation`, about the centre. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The file drawn. Planned as the size this cell needs; swapped for a
   *  bigger copy already on the device when the page is shown. */
  src: string;
  alt: string;
  /** The photo's stored sizes, and how wide it draws here in real pixels —
   *  what picks the file (lib/media/variant-choice.ts). */
  variants: readonly BoardPhotoVariant[];
  needed: number;
  artsy?: PlannedArtsy;
};

export type PlannedPage = {
  key: string;
  cycle: number;
  index: number;
  photoIds: string[];
  cells: PlannedCell[];
};

export type PlayerSnapshot = {
  current: PlannedPage | null;
  /** The page being transitioned away from, while the transition runs. */
  previous: PlannedPage | null;
  playing: boolean;
  /** The album has photos but none the engine can place yet (no sizes). */
  unsized: boolean;
  /** How long after the swap the current page starts arriving — fixed when it
   *  is shown, so removing the old page later can't restart its animation. */
  currentOffset: number;
};

export type PlayerInputs = {
  photos: readonly BoardPhoto[];
  /** The box in board design units — what layouts are computed in. */
  box: CollageBox;
  /** The box in real pixels, and the device pixel ratio — what picks the
   *  smallest variant that's still sharp. */
  boxPx: CollageBox;
  dpr: number;
  config: CollageConfig;
  /** Which albums, as a stable string (widgets/media/albums.ts) — part of the
   *  layout key and the shuffle seed. */
  albumKey: string;
  /** Which files are on the device, and where to say which ones this collage
   *  will use (lib/board-files.ts). In the editor, EVERY_FILE_READY. */
  files: BoardFiles;
};

function usable(photos: readonly BoardPhoto[]): EnginePhoto[] {
  const out: EnginePhoto[] = [];
  for (const photo of photos) {
    if (!photo.width || !photo.height) continue;
    out.push({
      id: photo.assetId,
      width: photo.width,
      height: photo.height,
      addedAt: photo.addedAt ?? null,
      photo,
      variants: photoVariants(photo),
    });
  }
  return out;
}

const loaded = new Map<string, Promise<void>>();

/** Resolve once every image is decoded (or has failed — a broken photo must not
 *  hold the cycle forever; on a display the file is already on the device, so
 *  that is rare). */
function preload(urls: readonly string[]): Promise<void> {
  return Promise.all(
    urls.map((url) => {
      let promise = loaded.get(url);
      if (!promise) {
        promise = new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            if (typeof img.decode === "function") img.decode().then(resolve, resolve);
            else resolve();
          };
          img.onerror = () => {
            loaded.delete(url);
            resolve();
          };
          img.src = url;
        });
        loaded.set(url, promise);
      }
      return promise;
    }),
  ).then(() => undefined);
}

/** A page whose every photo has a file on the device, with each cell's `src`
 *  set to that file; null when any is missing. */
function readyPage(page: PlannedPage, files: BoardFiles | null): PlannedPage | null {
  // Only the display's runtime makes a page wait for its files.
  if (!files?.gated) return page;
  const cells: PlannedCell[] = [];
  for (const cell of page.cells) {
    const variant = readyVariant(cell.variants, cell.needed, files.isReady);
    if (!variant) return null;
    cells.push(variant.src === cell.src ? cell : { ...cell, src: variant.src });
  }
  return { ...page, cells };
}

/** How many cycles are planned ahead. A fixed order repeats the same pages
 *  every cycle, so one is all of it. Shuffle deals a new arrangement each
 *  cycle; planning the next one too means a photo that lands in a bigger cell
 *  next time is fetched at that size before it's needed. */
const CYCLES_AHEAD_SHUFFLED = 2;

/** Between two pages of background planning — lets a TV's single slow core
 *  draw the board in between. */
const PLAN_STEP_MS = 40;

/** A page is held at most this many intervals waiting for the next one's
 *  files, then the collage skips to the next page that's fully here. */
const HOLD_INTERVALS = 3;

let owners = 0;

type Cycle = { pages: PlannedPage[]; done: boolean };

export class CollagePlayer {
  private listeners = new Set<() => void>();
  private snapshot: PlayerSnapshot = { current: null, previous: null, playing: true, unsized: false, currentOffset: 0 };
  private inputs: PlayerInputs | null = null;
  private layoutKey = "";
  private version = 0;
  private photos: EnginePhoto[] = [];
  /** Who this collage is when it tells the board which files it wants. */
  private readonly owner = `collage-${(owners += 1)}`;

  /** Every page planned so far, by cycle. A cycle's pages are fixed once
   *  planned: the same on every screen, and what was declared. */
  private cycles = new Map<number, Cycle>();
  /** Where the cycle stands: the next page to show is `index` of `cycle`. */
  private cycle = 0;
  private index = 0;
  private shownAt: number | null = null;
  private lastSecond: number | null = null;
  /** A swap is decoding its images; don't start another. */
  private swapping = false;
  /** Bumped on every reset, so work started for an older layout is dropped. */
  private generation = 0;
  private planning = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private emit(patch: Partial<PlayerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private later(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(id);
  }

  dispose() {
    this.disposed = true;
    this.inputs?.files?.want(this.owner, [], true);
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.listeners.clear();
  }

  /** The latest album, box, settings and files. Cheap to call on every render. */
  setInputs(inputs: PlayerInputs) {
    const photos = usable(inputs.photos);
    const version = albumVersion(photos);
    const { config, box } = inputs;
    const layoutKey = [
      inputs.albumKey,
      config.gutter,
      config.density,
      config.exactCount,
      config.order,
      config.style,
      config.style === "artsy" ? [config.artsyFrame, config.artsyTilt, config.artsyOverlap, config.artsyFasteners].join(",") : "",
      Math.round(box.width),
      Math.round(box.height),
      // The real pixels and pixel ratio pick the files, not the layout, but
      // a different size means different files to declare.
      Math.round(inputs.boxPx.width * inputs.dpr),
      photos.length > 0,
    ].join("|");

    const filesChanged = inputs.files !== this.inputs?.files;
    this.inputs = inputs;
    this.photos = photos;
    const albumChanged = version !== this.version;
    this.version = version;

    const unsized = inputs.photos.length > 0 && photos.length === 0;
    if (unsized !== this.snapshot.unsized) this.emit({ unsized });

    if (layoutKey !== this.layoutKey) {
      this.layoutKey = layoutKey;
      this.reset();
    } else if (albumChanged) {
      // Not a reset: the page on screen stays until its boundary, and every
      // page after it is re-planned from the album as it is now.
      this.replanFrom(this.cycle, this.index);
    } else if (filesChanged && !this.snapshot.current) {
      // Waiting for a first page, and more files have landed.
      this.later(() => this.showFirst(), 0);
    }
  }

  private reset() {
    this.generation += 1;
    this.cycles = new Map();
    this.cycle = 0;
    this.index = 0;
    this.shownAt = null;
    this.swapping = false;
    this.planning = false;
    if (this.photos.length === 0) {
      this.inputs?.files?.want(this.owner, [], true);
      this.emit({ current: null, previous: null });
      return;
    }
    const generation = this.generation;
    this.later(() => {
      if (generation !== this.generation) return;
      this.planStep();
      this.showFirst();
    }, 0);
  }

  /** Drop every planned page from `index` of `cycle` on, and plan them again. */
  private replanFrom(cycle: number, index: number) {
    for (const key of [...this.cycles.keys()]) if (key > cycle) this.cycles.delete(key);
    const kept = this.cycles.get(cycle);
    if (kept) this.cycles.set(cycle, { pages: kept.pages.slice(0, index), done: false });
    this.generation += 1;
    this.planning = false;
    this.planStep();
  }

  /** The cycles to plan: this one, and the next when shuffled. */
  private cyclesWanted(): number[] {
    const ahead = this.inputs?.config.order === "shuffle" ? CYCLES_AHEAD_SHUFFLED : 1;
    return Array.from({ length: ahead }, (_, i) => this.cycle + i);
  }

  /** Plan one more page, then schedule the next step until every wanted
   *  cycle is planned. Declares the files after each. */
  private planStep() {
    // Only a display plans ahead — it has files to fetch. The editor plans
    // each page as it's reached (pageAt), which is all a preview needs.
    if (this.planning || this.disposed || !this.inputs?.files.gated) return;
    const pending = this.cyclesWanted().find((cycle) => !this.cycles.get(cycle)?.done);
    if (pending === undefined) {
      this.announce(true);
      return;
    }
    this.planning = true;
    const generation = this.generation;
    const entry = this.entry(pending);
    const shown = new Set(entry.pages.flatMap((page) => page.photoIds));
    const page = this.plan(pending, entry.pages.length, shown);
    if (page) entry.pages.push(page);
    else entry.done = true;
    this.announce(false);
    this.later(() => {
      if (generation !== this.generation) return;
      this.planning = false;
      this.planStep();
    }, PLAN_STEP_MS);
  }

  /** Build page `index` of `cycle` from the photos not on that cycle's earlier
   *  pages. Null when those are used up (the cycle is over). */
  private plan(cycle: number, index: number, shown: ReadonlySet<string>): PlannedPage | null {
    const inputs = this.inputs;
    if (!inputs || this.photos.length === 0) return null;
    const { config, box, boxPx, dpr } = inputs;

    const ordered = orderPhotos(this.photos, config.order, hashSeed(inputs.albumKey, "cycle", cycle));
    const remaining = ordered.filter((photo) => !shown.has(photo.id));
    if (remaining.length === 0) return null;

    const artsy = config.style === "artsy";
    const page = nextPage(
      remaining,
      box,
      artsy
        ? {
            ...ARTSY_PAGINATION,
            engine: artsyEngine({
              frame: config.artsyFrame,
              tilt: config.artsyTilt,
              overlap: config.artsyOverlap,
              fasteners: config.artsyFasteners,
            }),
            density: config.density,
            exactCount: Math.min(config.exactCount, ARTSY_PAGINATION.maxPerPage ?? 10),
          }
        : { gap: config.gutter, density: config.density, exactCount: config.exactCount },
      pageSeed(this.version, index, box),
    );
    const byId = new Map(page.photos.map((photo) => [photo.id, photo]));
    const key = `${cycle}:${index}:${this.version}:${this.layoutKey}`;
    const photoIds = page.photos.map((photo) => photo.id);
    const source = (photoId: string, widthUnits: number) => {
      const photo = byId.get(photoId)!;
      const needed = (widthUnits / box.width) * boxPx.width * dpr;
      return { src: pickVariant(photo.variants, needed).src, alt: photo.photo.caption ?? "", variants: photo.variants, needed };
    };
    if (artsy) {
      const cells = artsyCells(page.layout as ArtsyLayout, box, (item) => source(item.photoId, item.image.w));
      return { key, cycle, index, photoIds, cells };
    }
    const cells: PlannedCell[] = page.layout.cells.map((cell) => ({
      id: cell.photoId,
      left: (cell.x / box.width) * 100,
      top: (cell.y / box.height) * 100,
      width: (cell.w / box.width) * 100,
      height: (cell.h / box.height) * 100,
      ...source(cell.photoId, cell.w),
    }));
    return { key, cycle, index, photoIds, cells };
  }

  /**
   * Tell the board which files this collage will use, in the order it will
   * show them: from the page after this one, through the planned cycles, and
   * round to the start again. One file per photo — the biggest size any of
   * its planned cells needs, which serves every smaller one too
   * (lib/media/variant-choice.ts).
   */
  private announce(complete: boolean) {
    const files = this.inputs?.files;
    if (!files?.gated) return;
    const pages: PlannedPage[] = [];
    const cycles = [...this.cycles.keys()].sort((a, b) => a - b);
    for (const cycle of cycles) {
      const entry = this.cycles.get(cycle)!;
      pages.push(...(cycle === this.cycle ? entry.pages.slice(this.index) : entry.pages));
    }
    // Then the pages of this cycle already passed, which come round again.
    pages.push(...(this.cycles.get(this.cycle)?.pages.slice(0, this.index) ?? []));

    const largest = new Map<string, BoardPhotoVariant>();
    const order: string[] = [];
    for (const page of pages) {
      for (const cell of page.cells) {
        const planned = pickVariant(cell.variants, cell.needed);
        const best = largest.get(cell.id);
        if (!best) order.push(cell.id);
        if (!best || planned.width > best.width) largest.set(cell.id, planned);
      }
    }
    files.want(
      this.owner,
      order.map((id) => largest.get(id)!.src),
      complete,
    );
  }

  /**
   * A cycle's pages. In a fixed order every cycle is the same pages — same
   * order, same seeds — so a cycle already planned in full is reused rather
   * than planned again; only a shuffle deals new ones.
   */
  private entry(cycle: number): Cycle {
    let entry = this.cycles.get(cycle);
    if (!entry && this.inputs?.config.order !== "shuffle") {
      const source = [...this.cycles.values()].find((planned) => planned.done);
      if (source) {
        entry = {
          done: true,
          pages: source.pages.map((page) => ({ ...page, cycle, key: page.key.replace(/^\d+:/, `${cycle}:`) })),
        };
      }
    }
    entry ??= { pages: [], done: false };
    this.cycles.set(cycle, entry);
    return entry;
  }

  /** The page at a position, planning it now if the background hasn't yet;
   *  rolls into the next cycle when this one is used up. */
  private pageAt(cycle: number, index: number): PlannedPage | null {
    for (let guard = 0; guard < 2; guard += 1) {
      const entry = this.entry(cycle);
      while (entry.pages.length <= index && !entry.done) {
        const shown = new Set(entry.pages.flatMap((page) => page.photoIds));
        const page = this.plan(cycle, entry.pages.length, shown);
        if (page) entry.pages.push(page);
        else entry.done = true;
      }
      if (entry.pages[index]) return entry.pages[index];
      cycle += 1;
      index = 0;
    }
    return null;
  }

  /** The position after one. */
  private after(cycle: number, index: number): { cycle: number; index: number } {
    const entry = this.cycles.get(cycle);
    if (entry && entry.done && index + 1 >= entry.pages.length) return { cycle: cycle + 1, index: 0 };
    return { cycle, index: index + 1 };
  }

  /** The first page that's fully on the device, starting at a position and
   *  looking at most one cycle ahead. */
  private firstReady(from: { cycle: number; index: number }): { page: PlannedPage; shown: PlannedPage } | null {
    const files = this.inputs?.files ?? null;
    let at = from;
    const limit = Math.max(1, this.photos.length) + 1;
    for (let i = 0; i < limit; i += 1) {
      const page = this.pageAt(at.cycle, at.index);
      if (!page) return null;
      const ready = readyPage(page, files);
      if (ready) return { page, shown: ready };
      at = this.after(page.cycle, page.index);
      if (at.cycle > from.cycle + 1) return null;
    }
    return null;
  }

  /** Put up the first page that's here — at boot, or once one has arrived. */
  private showFirst() {
    if (this.snapshot.current || this.swapping || this.photos.length === 0) return;
    const found = this.firstReady({ cycle: this.cycle, index: this.index });
    if (!found) return;
    this.swap(found.page, found.shown, false);
  }

  /** Decode a page's images, then put it on screen. */
  private swap(page: PlannedPage, shown: PlannedPage, transition: boolean) {
    this.swapping = true;
    const generation = this.generation;
    preload(shown.cells.map((cell) => cell.src)).then(() => {
      if (this.disposed) return;
      this.swapping = false;
      if (generation !== this.generation && this.snapshot.current) return;
      this.show(page, shown, transition);
    });
  }

  private show(page: PlannedPage, shown: PlannedPage, transition: boolean) {
    const cycleChanged = page.cycle !== this.cycle;
    this.cycle = page.cycle;
    this.index = page.index + 1;
    this.shownAt = this.lastSecond;
    if (cycleChanged) {
      // A new cycle: the one before is done with, and the one after that is
      // planned (and declared) when shuffled.
      for (const key of [...this.cycles.keys()]) if (key < this.cycle) this.cycles.delete(key);
      this.planStep();
    }
    this.announce(this.cyclesWanted().every((cycle) => this.cycles.get(cycle)?.done));

    const mode = this.inputs?.config.transition ?? "none";
    const speed = this.inputs?.config.transitionSpeed ?? 1;
    const leaving = this.snapshot.current;
    const keepPrevious = transition && mode !== "none" && leaving !== null;
    const total = keepPrevious ? transitionTotal(mode, leaving.cells.length, shown.cells.length, speed) : 0;
    this.emit({
      current: shown,
      previous: keepPrevious ? leaving : null,
      currentOffset: keepPrevious ? enterOffset(mode, leaving.cells.length, speed) : 0,
    });

    if (keepPrevious) {
      // Removed only once its last photo has finished leaving (./transitions.ts).
      const shownKey = shown.key;
      this.later(() => {
        if (this.snapshot.current?.key === shownKey) this.emit({ previous: null });
      }, total + 50);
    }
  }

  /** Move to the next page if it's here; hold, or skip ahead, if not. */
  private advance(force = false) {
    if (this.swapping) return;
    const current = this.snapshot.current;
    if (!current) {
      this.showFirst();
      return;
    }
    const next = this.pageAt(this.cycle, this.index);
    if (!next) return;
    const files = this.inputs?.files ?? null;
    let target: { page: PlannedPage; shown: PlannedPage } | null = null;
    const ready = readyPage(next, files);
    if (ready) {
      target = { page: next, shown: ready };
    } else {
      const interval = this.inputs?.config.intervalSeconds ?? 10;
      const held = this.shownAt === null || this.lastSecond === null ? 0 : this.lastSecond - this.shownAt;
      // Waited long enough: the next page that IS here, rather than this one
      // forever.
      if (force || held >= HOLD_INTERVALS * interval) target = this.firstReady(this.after(next.cycle, next.index));
    }
    if (!target) return;

    // A one-page album replays the same arrangement every cycle — nothing to
    // transition to, so just start the next interval.
    const same =
      current.cells.length === target.shown.cells.length &&
      current.cells.every((cell, i) => {
        const other = target.shown.cells[i];
        return cell.id === other.id && cell.left === other.left && cell.top === other.top && cell.width === other.width;
      });
    if (same) {
      this.cycle = target.page.cycle;
      this.index = target.page.index + 1;
      this.shownAt = this.lastSecond;
      return;
    }
    this.swap(target.page, target.shown, true);
  }

  /** Called once a second from the master tick (lib/tick.ts). */
  tick(second: number) {
    this.lastSecond = second;
    if (!this.snapshot.current) {
      this.showFirst();
      return;
    }
    if (this.shownAt === null) this.shownAt = second;
    const interval = this.inputs?.config.intervalSeconds ?? 10;
    if (!this.snapshot.playing || second - this.shownAt < interval) return;
    this.advance();
  }

  /** Show the next page now (the editor's "Next page"). */
  next() {
    this.advance(true);
  }

  /** Pause or resume the cycle (the editor's "Pause" / "Play"). */
  togglePlaying() {
    const playing = !this.snapshot.playing;
    if (playing) this.shownAt = this.lastSecond;
    this.emit({ playing });
  }
}
