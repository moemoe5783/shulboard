"use client";

import type { BundleEnvelope } from "@/lib/bundle/types";

/*
 * The atomic swap — docs/plan.md §3c.
 *
 * "Never apply bundle v(n+1) until every asset it references is cached.
 * Prevents 'new board, missing photos.'"
 *
 * This is the gate. A new bundle arrives, what its board needs is fetched into
 * the Cache Storage the service worker reads from, and only if all of it lands
 * does the bundle become the one being shown. Half a board is worse than an old
 * board: an old board is last week's kiddush photo, half a board is a grey
 * rectangle where a photo should be, on a wall, in front of people.
 *
 * "What its board needs" is not every photo in every album. A gallery of six
 * hundred photos shows one at a time, so the board goes up once the first few
 * of each album are here (warmOrder), and the rest download behind it. The
 * promise still holds because of cachedView: the albums on screen only ever
 * contain photos already cached, and grow as more arrive.
 */

export const ASSET_CACHE = "shulboard-assets-v1";

export type AssetProgress = { done: number; total: number };

/** How many downloads run at once. A TV browser handed hundreds of requests at
 *  once can stall or run out of memory; a handful in flight is as fast on a
 *  lobby connection and never does. */
const CONCURRENCY = 6;

/** How many photos of each album are downloaded before a board goes up. Enough
 *  that a gallery or collage has something to cycle through; the rest follow
 *  while the board is already on the wall. */
export const HEAD_START = 8;

/**
 * Which files a board needs before it can go up, and which can follow.
 *
 * Everything that isn't an album photo — an Image widget's picture, a photo
 * background — is needed first, since it is on screen from the first second.
 * So are the first HEAD_START photos of each album. The rest are taken a photo
 * from each album in turn, so every gallery gains variety at the same pace.
 */
export function warmOrder(bundle: BundleEnvelope): { first: string[]; rest: string[] } {
  const all = [...new Set(bundle.assets.map((asset) => asset.url))];
  const albums = Object.values(bundle.content.albums ?? {});
  const inAlbum = new Set(albums.flatMap((photos) => photos.map((photo) => photo.src)));

  const first = all.filter((url) => !inAlbum.has(url));
  const rest: string[] = [];
  const wanted = new Set(all);
  const seen = new Set(first);
  const longest = Math.max(0, ...albums.map((photos) => photos.length));
  for (let i = 0; i < longest; i += 1) {
    for (const photos of albums) {
      const url = photos[i]?.src;
      if (!url || seen.has(url) || !wanted.has(url)) continue;
      seen.add(url);
      (i < HEAD_START ? first : rest).push(url);
    }
  }
  return { first, rest };
}

/**
 * Put these files in the cache, and say whether they all made it.
 *
 * Deliberately not cache.addAll(): that rejects as a unit on the first failure
 * and tells you nothing about the rest, so one dead URL would keep a bundle out
 * forever with no way to see which one. Fetching each separately means a
 * fifty-photo board reports "49 of 50" and the log names the one.
 */
export async function warmUrls(
  urls: readonly string[],
  /** Called as files land (already-cached ones count as done straight away),
   *  so the screen can say how far along it is. */
  onProgress?: (progress: AssetProgress) => void,
  /** Checked between downloads; true stops the rest, because a newer board
   *  has arrived and these files may not be wanted any more. */
  stopped?: () => boolean,
): Promise<{ ready: boolean; missing: string[] }> {
  if (urls.length === 0) return { ready: true, missing: [] };

  if (typeof caches === "undefined") {
    // No Cache Storage — an old TV browser, or an insecure origin. The board
    // still renders and the images still load over the network; what is lost is
    // the offline guarantee, not the picture. Refusing the bundle here would
    // trade a real degradation for a hypothetical one.
    return { ready: true, missing: [] };
  }

  const cache = await caches.open(ASSET_CACHE);
  const missing: string[] = [];
  let done = 0;
  const report = () => onProgress?.({ done, total: urls.length });

  // What's already here doesn't need fetching — on an update that's usually
  // most of it — so it counts as done before any download starts.
  const toFetch: string[] = [];
  for (const url of urls) {
    if (await cache.match(url)) done += 1;
    else toFetch.push(url);
  }
  report();

  let next = 0;
  const worker = async () => {
    while (next < toFetch.length && !stopped?.()) {
      const url = toFetch[next++];
      try {
        const response = await fetch(url, { cache: "no-cache" });
        if (response.ok) await cache.put(url, response);
        else missing.push(url);
      } catch {
        missing.push(url);
      }
      done += 1;
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, worker));

  return { ready: missing.length === 0 && done === urls.length, missing };
}

/**
 * The bundle as the screen can show it right now: each album cut down to the
 * photos already in the cache.
 *
 * This is what lets a board go up before all its photos have arrived without
 * breaking the promise the atomic swap makes. A gallery only ever cycles through
 * photos this device already holds, so if the network drops halfway through a
 * download the board shows fewer photos, never a grey hole where one should be.
 * As more arrive the albums grow; the widgets take a changed album in their
 * stride (the collage re-plans at its next page, the gallery at its next photo).
 */
export async function cachedView(bundle: BundleEnvelope): Promise<BundleEnvelope> {
  if (typeof caches === "undefined") return bundle;
  const albums = bundle.content.albums ?? {};
  const wanted = new Set(bundle.assets.map((asset) => asset.url));
  const cache = await caches.open(ASSET_CACHE);

  let trimmed = false;
  const view: typeof albums = {};
  for (const [id, photos] of Object.entries(albums)) {
    const kept = [];
    for (const photo of photos) {
      // A photo whose file the bundle doesn't list isn't this gate's to hold.
      if (!wanted.has(photo.src) || (await cache.match(photo.src))) kept.push(photo);
    }
    if (kept.length !== photos.length) trimmed = true;
    view[id] = kept;
  }
  return trimmed ? { ...bundle, content: { ...bundle.content, albums: view } } : bundle;
}

/**
 * Drop cached assets no bundle references any more.
 *
 * A screen that runs for a year through fifty board changes would otherwise
 * accumulate every photograph the shul ever showed, and a TV's storage quota is
 * not generous. Runs after a successful swap, when the keep-list is known good.
 */
export async function evictUnusedAssets(bundle: BundleEnvelope): Promise<number> {
  if (typeof caches === "undefined") return 0;

  const cache = await caches.open(ASSET_CACHE);
  const keep = new Set(bundle.assets.map((asset) => new URL(asset.url, location.origin).href));
  const stored = await cache.keys();

  let removed = 0;
  for (const request of stored) {
    if (keep.has(request.url)) continue;
    if (await cache.delete(request)) removed += 1;
  }
  return removed;
}
