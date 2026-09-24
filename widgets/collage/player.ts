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
import type { BoardPhoto, BoardPhotoVariant } from "@/lib/media/album-photos";
import type { CollageConfig } from "./manifest";
import { enterOffset, transitionTotal } from "./transitions";

/*
 * The collage's cycle — which page is on screen, which is next, and when to
 * swap — kept outside React as a tiny store the Renderer subscribes to.
 *
 * WHAT IT GUARANTEES (the collage spec, §4):
 *  - Every photo once per cycle: a page is built from the album's photos NOT
 *    yet shown this cycle, so a cycle ends exactly when they're used up.
 *  - Album changes land at the next page boundary. The page on screen is never
 *    re-laid out; the NEXT page is re-planned from the latest album, so a new
 *    photo appears within the cycle and a deleted one simply isn't picked — the
 *    current page keeps it until it ends.
 *  - A transition never shows a half-loaded page: the next page's images are
 *    fully loaded before the swap, and if they aren't ready at the boundary the
 *    current page stays.
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
  source: (item: ArtsyLayout["items"][number]) => { src: string; alt: string },
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
  src: string;
  alt: string;
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
};


function usable(photos: readonly BoardPhoto[]): EnginePhoto[] {
  const out: EnginePhoto[] = [];
  for (const photo of photos) {
    if (!photo.width || !photo.height) continue;
    const variants = photo.variants?.length
      ? photo.variants
      : [{ name: "display", src: photo.src, width: photo.width, height: photo.height, contentType: "", bytes: 0 }];
    out.push({ id: photo.assetId, width: photo.width, height: photo.height, addedAt: photo.addedAt ?? null, photo, variants });
  }
  return out;
}

/** The smallest stored size that is at least as wide as it renders. */
function pickVariant(variants: readonly BoardPhotoVariant[], neededWidth: number): BoardPhotoVariant {
  return variants.find((variant) => variant.width >= neededWidth) ?? variants[variants.length - 1];
}

const loaded = new Map<string, Promise<void>>();

/** Resolve once every image is decoded (or has failed — a broken photo must not
 *  hold the cycle forever; the display has it cached, so that is rare). */
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

type Upcoming = {
  page: PlannedPage;
  cycle: number;
  index: number;
  /** The album version it was planned from — stale once the album changes. */
  version: number;
  ready: boolean;
};

export class CollagePlayer {
  private listeners = new Set<() => void>();
  private snapshot: PlayerSnapshot = { current: null, previous: null, playing: true, unsized: false, currentOffset: 0 };
  private inputs: PlayerInputs | null = null;
  private layoutKey = "";
  private version = 0;
  private photos: EnginePhoto[] = [];

  /** Where the cycle stands: the next page to show is `index` of `cycle`. */
  private cycle = 0;
  private index = 0;
  private shown = new Set<string>();
  private upcoming: Upcoming | null = null;
  private shownAt: number | null = null;
  private lastSecond: number | null = null;
  private advanceWhenReady = false;
  /** Bumped on every reset, so work started for an older layout is dropped. */
  private generation = 0;
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
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.listeners.clear();
  }

  /** The latest album, box and settings. Cheap to call on every render. */
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
      photos.length > 0,
    ].join("|");

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
      // Not a reset: the page on screen stays until its boundary, and the next
      // page is re-planned from the album as it is now.
      this.upcoming = null;
      this.later(() => this.planUpcoming(), 0);
    }
  }

  private reset() {
    this.generation += 1;
    this.cycle = 0;
    this.index = 0;
    this.shown = new Set();
    this.upcoming = null;
    this.shownAt = null;
    this.advanceWhenReady = false;
    if (this.photos.length === 0) {
      this.emit({ current: null, previous: null });
      return;
    }
    const generation = this.generation;
    this.later(() => {
      if (generation !== this.generation) return;
      const planned = this.plan(0, 0, new Set());
      if (!planned) return;
      preload(planned.cells.map((cell) => cell.src)).then(() => {
        if (generation !== this.generation || this.disposed) return;
        this.show({ page: planned, cycle: 0, index: 0, version: this.version, ready: true }, false);
      });
    }, 0);
  }

  /** Build page `index` of `cycle`, excluding what that cycle already showed.
   *  Null when those photos are used up (the cycle is over). */
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
    if (artsy) {
      const cells = artsyCells(page.layout as ArtsyLayout, box, (item) => {
        const photo = byId.get(item.photoId)!;
        const needed = (item.image.w / box.width) * boxPx.width * dpr;
        return { src: pickVariant(photo.variants, needed).src, alt: photo.photo.caption ?? "" };
      });
      return {
        key: `${cycle}:${index}:${this.version}:${this.layoutKey}`,
        cycle,
        index,
        photoIds: page.photos.map((photo) => photo.id),
        cells,
      };
    }
    const cells: PlannedCell[] = page.layout.cells.map((cell) => {
      const photo = byId.get(cell.photoId)!;
      const needed = (cell.w / box.width) * boxPx.width * dpr;
      return {
        id: cell.photoId,
        left: (cell.x / box.width) * 100,
        top: (cell.y / box.height) * 100,
        width: (cell.w / box.width) * 100,
        height: (cell.h / box.height) * 100,
        src: pickVariant(photo.variants, needed).src,
        alt: photo.photo.caption ?? "",
      };
    });
    return {
      key: `${cycle}:${index}:${this.version}:${this.layoutKey}`,
      cycle,
      index,
      photoIds: page.photos.map((photo) => photo.id),
      cells,
    };
  }

  /** Plan the page after the current one (rolling into a new cycle when this
   *  one is used up) and start loading its images. */
  private planUpcoming() {
    if (!this.snapshot.current || this.upcoming) return;
    const generation = this.generation;
    const version = this.version;

    let cycle = this.cycle;
    let index = this.index;
    let page = this.plan(cycle, index, this.shown);
    if (!page) {
      cycle += 1;
      index = 0;
      page = this.plan(cycle, index, new Set());
    }
    if (!page) return;

    const upcoming: Upcoming = { page, cycle, index, version, ready: false };
    this.upcoming = upcoming;
    preload(page.cells.map((cell) => cell.src)).then(() => {
      if (generation !== this.generation || this.upcoming !== upcoming) return;
      upcoming.ready = true;
      if (this.advanceWhenReady) this.advance();
    });
  }

  private show(next: Upcoming, transition: boolean) {
    if (next.cycle !== this.cycle) {
      this.cycle = next.cycle;
      this.shown = new Set();
    }
    for (const id of next.page.photoIds) this.shown.add(id);
    this.index = next.index + 1;
    this.upcoming = null;
    this.shownAt = this.lastSecond;
    this.advanceWhenReady = false;

    const mode = this.inputs?.config.transition ?? "none";
    const speed = this.inputs?.config.transitionSpeed ?? 1;
    const leaving = this.snapshot.current;
    const keepPrevious = transition && mode !== "none" && leaving !== null;
    const total = keepPrevious ? transitionTotal(mode, leaving.cells.length, next.page.cells.length, speed) : 0;
    this.emit({
      current: next.page,
      previous: keepPrevious ? leaving : null,
      currentOffset: keepPrevious ? enterOffset(mode, leaving.cells.length, speed) : 0,
    });

    if (keepPrevious) {
      // Removed only once its last photo has finished leaving (./transitions.ts).
      const shownKey = next.page.key;
      this.later(() => {
        if (this.snapshot.current?.key === shownKey) this.emit({ previous: null });
      }, total + 50);
    }
    // Plan the next page once the transition has settled, so the search never
    // competes with the animation for a TV's single slow core.
    this.later(() => this.planUpcoming(), total + 100);
  }

  private advance() {
    const upcoming = this.upcoming;
    if (!upcoming || !upcoming.ready) {
      this.advanceWhenReady = true;
      if (!upcoming) this.planUpcoming();
      return;
    }
    if (upcoming.version !== this.version) {
      // Planned from an album that has since changed — plan again from the
      // album as it is now, and swap as soon as that's loaded.
      this.upcoming = null;
      this.advanceWhenReady = true;
      this.planUpcoming();
      return;
    }
    // A one-page album replays the same arrangement every cycle — nothing to
    // transition to, so just start the next interval.
    const current = this.snapshot.current;
    const same =
      current !== null &&
      current.cells.length === upcoming.page.cells.length &&
      current.cells.every((cell, i) => {
        const other = upcoming.page.cells[i];
        return cell.id === other.id && cell.left === other.left && cell.top === other.top && cell.width === other.width;
      });
    if (same) {
      this.cycle = upcoming.cycle;
      this.shown = new Set(upcoming.page.photoIds);
      this.index = upcoming.index + 1;
      this.upcoming = null;
      this.shownAt = this.lastSecond;
      this.advanceWhenReady = false;
      this.later(() => this.planUpcoming(), 100);
      return;
    }
    this.show(upcoming, true);
  }

  /** Called once a second from the master tick (lib/tick.ts). */
  tick(second: number) {
    this.lastSecond = second;
    if (this.shownAt === null && this.snapshot.current) this.shownAt = second;
    const interval = this.inputs?.config.intervalSeconds ?? 10;
    if (!this.snapshot.playing || this.shownAt === null || second - this.shownAt < interval) return;
    this.advance();
  }

  /** Show the next page now (the editor's "Next page"). */
  next() {
    this.advance();
  }

  /** Pause or resume the cycle (the editor's "Pause" / "Play"). */
  togglePlaying() {
    const playing = !this.snapshot.playing;
    if (playing) this.shownAt = this.lastSecond;
    this.emit({ playing });
  }
}
