"use client";

/*
 * The display's /m counters, kept by the service worker (public/sw.js): how
 * many photo requests it answered from the device and how many went to the
 * network, since this page last booted. A screen that has been through one
 * full cycle of its board should show the network count standing still —
 * after a reboot, from zero.
 *
 * Read by the `?debug` view on /s/ and nowhere else.
 */

export type MediaStats = { hits: number; network: number; since: number };

function worker(): ServiceWorker | null {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker.controller : null;
}

/** Start counting from now — called once at boot. */
export function resetMediaStats(): void {
  worker()?.postMessage({ type: "media-stats-reset" });
}

/** The counts so far, or null with no service worker in control. */
export function readMediaStats(): Promise<MediaStats | null> {
  const controller = worker();
  if (!controller) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 2000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data as MediaStats);
    };
    controller.postMessage({ type: "media-stats" }, [channel.port2]);
  });
}
