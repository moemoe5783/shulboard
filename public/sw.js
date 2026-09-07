/*
 * The display's service worker — docs/plan.md §3c.
 *
 * SCOPED TO /s/, NOT THE WHOLE ORIGIN. A root-scope worker would also control
 * the dashboard, and serving a cached authenticated page to the next person at
 * that desk is a data leak dressed as a performance win. It is registered with
 * { scope: "/s/" }; a worker still sees every request its controlled pages make,
 * so display subresources on /_next/ and /m/ are covered without widening it.
 *
 * THE APP SHELL IS CACHED TOO, and that is not an optimisation. §3c says the
 * screen renders from IndexedDB immediately on boot. A television that reboots
 * while the shul's router is down has to get the HTML and the JavaScript from
 * somewhere before it can read IndexedDB at all — without this, "last-known-good
 * bundle" would only survive a reload with the network up, which is the one case
 * it is not for.
 */

const SHELL = "shulboard-shell-v1";
const ASSETS = "shulboard-assets-v1";

self.addEventListener("install", () => {
  // Nothing to precache: Next's chunk names are build-specific and this file is
  // static. The shell fills itself on the first online load, which every screen
  // has by definition — it was paired over the network.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop shells from older deploys. The asset cache is deliberately NOT
      // dropped: its contents are immutable by path and are what the atomic
      // swap already verified.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("shulboard-shell-") && name !== SHELL)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Immutable by construction: a variant's path contains its content hash, so a
 *  re-processed asset is a new path rather than a stale hit. */
const isAsset = (url) => url.pathname.startsWith("/m/") || url.pathname.startsWith("/demo/");
const isBuildOutput = (url) => url.pathname.startsWith("/_next/static/");

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The bundle and the heartbeat are never cached. The bundle carries its own
  // ETag and the display's last-known-good copy lives in IndexedDB, which is a
  // better store for it than an HTTP cache that cannot be read as data; a cached
  // heartbeat is a lie about a screen being alive.
  if (url.pathname.startsWith("/api/")) return;

  if (isAsset(url)) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }

  if (isBuildOutput(url)) {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }

  if (request.mode === "navigate") {
    // Network-first, so a redeploy reaches the screen on its next reload rather
    // than on its next cache eviction. The cached copy is the fallback that
    // makes a reboot during an outage survivable.
    event.respondWith(networkFirst(request, SHELL));
  }
});
