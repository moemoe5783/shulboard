"use client";

import type { BoardFiles } from "@/lib/board-assets";
import type { BundleEnvelope } from "@/lib/bundle/types";

/*
 * The files on this device — docs/plan.md §3c's asset cache, and the atomic
 * swap's promise: "never apply bundle v(n+1) until every asset it references
 * is cached. Prevents 'new board, missing photos.'"
 *
 * TWO KINDS OF FILE, fetched two ways.
 *
 *  - A BOARD'S OWN PICTURES — an Image widget's photo, a picture background —
 *    are listed in the bundle and on screen from the first second, so a new
 *    board waits for all of them (`warmUrls`) before it goes up.
 *  - ALBUM PHOTOS are not in that list. Which file of which photo a Gallery or
 *    Collage shows depends on its size on this screen, which only the widget
 *    knows once it's drawn. So each widget declares its files, in the order it
 *    will show them (lib/board-assets.tsx, `want`), and this downloads them —
 *    round-robin across widgets, so every widget's next page comes before any
 *    widget's tenth. A widget shows a page only once all of it is here.
 *
 * Nothing else is downloaded: a size no layout on this board uses stays on
 * the server. And eviction keeps exactly what the board uses — its own
 * pictures and every file its widgets declared — once every widget has
 * declared its whole cycle.
 *
 * WHAT'S ON THE DEVICE is read from Cache Storage once, at boot, and kept as a
 * set: on a TV each cache lookup can take tens of milliseconds, and asking for
 * six hundred of them one by one is half a minute of a dark screen.
 */

export const ASSET_CACHE = "shulboard-assets-v1";

export type AssetProgress = { done: number; total: number };

/** How many downloads run at once. A TV browser handed hundreds of requests at
 *  once can stall or run out of memory; a handful in flight is as fast on a
 *  lobby connection and never does. */
const CONCURRENCY = 6;

/** How many of each widget's files count as its opening page — what a board
 *  waits for, behind the loading screen, the first time it goes up. */
export const HEAD_START = 8;

/** Changes are told to the screen at most this often, so a board with hundreds
 *  of photos doesn't re-render for every one. */
const NOTIFY_MS = 500;

/** A file that failed isn't tried again for this long. */
const RETRY_MS = 60_000;

/** A path, whatever form it arrives in — "/m/…" or an absolute URL. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url, location.origin);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

/** The board's own pictures: what the bundle lists, less any album photo (an
 *  older bundle listed those too; widgets fetch them now). */
export function boardPictureUrls(bundle: BundleEnvelope): string[] {
  const albumFiles = new Set<string>();
  for (const photos of Object.values(bundle.content.albums ?? {})) {
    for (const photo of photos) {
      albumFiles.add(photo.src);
      for (const variant of photo.variants ?? []) albumFiles.add(variant.src);
    }
  }
  return [...new Set(bundle.assets.map((asset) => asset.url))].filter((url) => !albumFiles.has(url));
}

/** Everything a bundle needs on the device before it goes up: the board's
 *  own pictures, and the font files it draws in with their stylesheet
 *  (lib/fonts/board-fonts.ts) — so a reboot offline has its type too. */
export function boardFileUrls(bundle: BundleEnvelope): string[] {
  const fonts = bundle.fonts ? [bundle.fonts.stylesheet, ...bundle.fonts.files] : [];
  return [...boardPictureUrls(bundle), ...fonts];
}

type Owner = { srcs: string[]; complete: boolean };

export type DeviceFilesStats = {
  /** Files in the asset cache. */
  cached: number;
  /** Album files the board's widgets want, and how many of them are here. */
  wanted: number;
  wantedReady: number;
  /** Downloads that failed and wait to be retried. */
  failed: number;
  /** A write was refused for lack of space; background downloads stopped. */
  full: boolean;
};

export class DeviceFiles {
  private ready = new Set<string>();
  private owners = new Map<string, Owner>();
  private inFlight = new Set<string>();
  private failedAt = new Map<string, number>();
  private listeners = new Set<() => void>();
  private version = 0;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private running = 0;
  private full = false;
  private cache: Cache | null = null;
  private available = typeof caches !== "undefined";
  private snapshot: BoardFiles;

  constructor() {
    this.snapshot = this.makeSnapshot();
  }

  /** Read what's already cached. Call once, before the board goes up. */
  async load(): Promise<void> {
    if (!this.available) return;
    try {
      this.cache = await caches.open(ASSET_CACHE);
      for (const request of await this.cache.keys()) this.ready.add(pathOf(request.url));
    } catch {
      this.available = false;
    }
    this.bump();
  }

  // ---- what widgets see (lib/board-assets.tsx) ----------------------------

  private makeSnapshot(): BoardFiles {
    return {
      // The display: pages wait for their files.
      gated: true,
      version: this.version,
      // No Cache Storage (an old TV browser, an insecure origin): there's no
      // offline copy to wait for, so every file counts as ready and loads over
      // the network like any web page.
      isReady: (src) => !this.available || this.ready.has(pathOf(src)),
      want: (owner, srcs, complete) => this.want(owner, srcs, complete),
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stable between changes, so a board only re-renders when files land. */
  getSnapshot = () => this.snapshot;

  private bump() {
    this.version += 1;
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.snapshot = this.makeSnapshot();
      for (const listener of this.listeners) listener();
    }, NOTIFY_MS);
  }

  private want(owner: string, srcs: readonly string[], complete: boolean) {
    const paths = srcs.map(pathOf);
    if (paths.length === 0) this.owners.delete(owner);
    else this.owners.set(owner, { srcs: paths, complete });
    this.pump();
    this.bump();
  }

  // ---- downloading ---------------------------------------------------------

  isReady(url: string): boolean {
    return !this.available || this.ready.has(pathOf(url));
  }

  /** Every file any widget wants, round-robin across widgets in each one's
   *  own order — the next page of every widget before any widget's later ones. */
  private queue(): string[] {
    const lists = [...this.owners.values()].map((owner) => owner.srcs);
    const longest = Math.max(0, ...lists.map((list) => list.length));
    const out: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < longest; i += 1) {
      for (const list of lists) {
        const src = list[i];
        if (src && !seen.has(src)) {
          seen.add(src);
          out.push(src);
        }
      }
    }
    return out;
  }

  private nextToFetch(): string | null {
    const now = Date.now();
    for (const src of this.queue()) {
      if (this.ready.has(src) || this.inFlight.has(src)) continue;
      const failed = this.failedAt.get(src);
      if (failed && now - failed < RETRY_MS) continue;
      return src;
    }
    return null;
  }

  private pump() {
    if (!this.available || this.full) return;
    while (this.running < CONCURRENCY) {
      const src = this.nextToFetch();
      if (!src) return;
      this.running += 1;
      void this.fetchOne(src).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  /** Fetch one file into the cache. True when it's there. */
  private async fetchOne(src: string): Promise<boolean> {
    this.inFlight.add(src);
    try {
      const cache = this.cache ?? (await caches.open(ASSET_CACHE));
      this.cache = cache;
      const response = await fetch(src, { cache: "no-cache" });
      if (!response.ok) throw new Error(String(response.status));
      await cache.put(src, response);
      this.ready.add(src);
      this.failedAt.delete(src);
      this.bump();
      return true;
    } catch (error) {
      // Out of room: stop filling the cache behind the board rather than
      // fighting the browser for it. What's here keeps working; the board's
      // own pictures and the next pages were first in line.
      if (error instanceof DOMException && error.name === "QuotaExceededError") this.full = true;
      this.failedAt.set(src, Date.now());
      this.bump();
      return false;
    } finally {
      this.inFlight.delete(src);
    }
  }

  /**
   * Put these files in the cache, and say whether they all made it — a new
   * board's own pictures, before it goes up.
   *
   * Deliberately not cache.addAll(): that rejects as a unit on the first failure
   * and tells you nothing about the rest, so one dead URL would keep a bundle out
   * forever with no way to see which one. Fetching each separately means a
   * fifty-photo board reports "49 of 50" and the log names the one.
   */
  async warmUrls(
    urls: readonly string[],
    onProgress?: (progress: AssetProgress) => void,
  ): Promise<{ ready: boolean; missing: string[] }> {
    if (urls.length === 0 || !this.available) return { ready: true, missing: [] };
    const paths = [...new Set(urls.map(pathOf))];
    const toFetch = paths.filter((path) => !this.ready.has(path));
    let done = paths.length - toFetch.length;
    const report = () => onProgress?.({ done, total: paths.length });
    report();
    const missing: string[] = [];
    let next = 0;
    const worker = async () => {
      while (next < toFetch.length) {
        const src = toFetch[next++];
        if (!(await this.fetchOne(src))) missing.push(src);
        done += 1;
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker));
    return { ready: missing.length === 0, missing };
  }

  // ---- where things stand --------------------------------------------------

  /** The first HEAD_START files of each widget: how far along the opening
   *  pages are, for the loading screen. */
  headProgress(): AssetProgress {
    const head = new Set<string>();
    for (const owner of this.owners.values()) for (const src of owner.srcs.slice(0, HEAD_START)) head.add(src);
    let done = 0;
    for (const src of head) if (this.ready.has(src) || this.failedAt.has(src) || !this.available) done += 1;
    return { done, total: head.size };
  }

  /** Every album file wanted, and how many are here. */
  wantedProgress(): AssetProgress {
    const all = new Set(this.queue());
    let done = 0;
    for (const src of all) if (this.ready.has(src) || !this.available) done += 1;
    return { done, total: all.size };
  }

  /** Every widget on the board has declared its whole cycle. */
  allDeclared(): boolean {
    return [...this.owners.values()].every((owner) => owner.complete);
  }

  stats(): DeviceFilesStats {
    const wanted = this.wantedProgress();
    return {
      cached: this.ready.size,
      wanted: wanted.total,
      wantedReady: wanted.done,
      failed: this.failedAt.size,
      full: this.full,
    };
  }

  /**
   * Drop cached files the board no longer uses: anything that isn't one of its
   * own pictures or a file a widget declared. Only once every widget has
   * declared its whole cycle — before that, "not wanted" might just mean "not
   * planned yet". A screen that runs for a year through fifty board changes
   * would otherwise keep every photograph the shul ever showed, and a TV's
   * storage quota is not generous.
   */
  async evict(boardPictures: readonly string[]): Promise<number> {
    if (!this.available || !this.allDeclared()) return 0;
    const keep = new Set([...boardPictures.map(pathOf), ...this.queue()]);
    const cache = this.cache ?? (await caches.open(ASSET_CACHE));
    let removed = 0;
    for (const request of await cache.keys()) {
      const path = pathOf(request.url);
      if (keep.has(path)) continue;
      if (await cache.delete(request)) {
        this.ready.delete(path);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.full = false;
      this.bump();
    }
    return removed;
  }
}
