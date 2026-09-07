"use client";

import type { BundleEnvelope } from "@/lib/bundle/types";

/*
 * The atomic swap — docs/plan.md §3c.
 *
 * "Never apply bundle v(n+1) until every asset it references is cached.
 * Prevents 'new board, missing photos.'"
 *
 * This is the gate. A new bundle arrives, every asset it names is fetched into
 * the Cache Storage the service worker reads from, and only if all of them land
 * does the bundle become the one being shown. Half a board is worse than an old
 * board: an old board is last week's kiddush photo, half a board is a grey
 * rectangle where a photo should be, on a wall, in front of people.
 */

export const ASSET_CACHE = "shulboard-assets-v1";

/**
 * Put every asset in the cache, and say whether they all made it.
 *
 * Deliberately not cache.addAll(): that rejects as a unit on the first failure
 * and tells you nothing about the rest, so one dead URL would keep a bundle out
 * forever with no way to see which one. Fetching each separately means a
 * fifty-photo board reports "49 of 50" and the log names the one.
 */
export async function warmAssets(bundle: BundleEnvelope): Promise<{
  ready: boolean;
  cached: number;
  total: number;
  missing: string[];
}> {
  const urls = [...new Set(bundle.assets.map((asset) => asset.url))];
  if (urls.length === 0) return { ready: true, cached: 0, total: 0, missing: [] };

  if (typeof caches === "undefined") {
    // No Cache Storage — an old TV browser, or an insecure origin. The board
    // still renders and the images still load over the network; what is lost is
    // the offline guarantee, not the picture. Refusing the bundle here would
    // trade a real degradation for a hypothetical one.
    return { ready: true, cached: 0, total: urls.length, missing: [] };
  }

  const cache = await caches.open(ASSET_CACHE);
  const missing: string[] = [];

  await Promise.all(
    urls.map(async (url) => {
      const already = await cache.match(url);
      if (already) return;

      try {
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) {
          missing.push(url);
          return;
        }
        await cache.put(url, response);
      } catch {
        missing.push(url);
      }
    }),
  );

  return { ready: missing.length === 0, cached: urls.length - missing.length, total: urls.length, missing };
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
