"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BundleEnvelope } from "@/lib/bundle/types";
import { cachedView, evictUnusedAssets, warmOrder, warmUrls, type AssetProgress } from "./assets";
import { forgetBundle, readBundle, writeBundle } from "./store";
import { deviceHeaders } from "./device";

/*
 * The display's whole runtime — docs/plan.md §3c, §3d, §3e.
 *
 * One hook, because these behaviours are not independent: the poll and the
 * realtime signal both end in the same refetch, the refetch ends in the atomic
 * swap, the swap decides what the heartbeat reports, and the nightly reload has
 * to know none of the others is mid-flight. Spread across four hooks they would
 * each be simpler and the interactions would live nowhere.
 *
 * THE ORDER ON BOOT IS THE PRODUCT. Read IndexedDB and render. Then fetch. Not
 * the other way round, and never a spinner: a screen that waits for the network
 * before drawing is black every time the shul's router reboots.
 */

const POLL_MS = 60_000;
const HEARTBEAT_MS = 60_000;
/** Roughly 3am local, jittered. plan.md §3e — memory leaks in TV WebViews are
 *  real, and fifty screens reloading on the same second is a self-inflicted
 *  thundering herd. */
const RELOAD_HOUR = 3;
const RELOAD_JITTER_MS = 20 * 60 * 1000;
/** How often albums on screen grow while photos download behind a board. Not
 *  on every photo: each growth can re-order a shuffled gallery. */
const GROW_MS = 15_000;

export type DisplayStatus = {
  /** Where what you are looking at came from. */
  source: "none" | "cache" | "network";
  /** False once a fetch fails, true again on the next success. Drives nothing
   *  visible by default — a stale board is still the right thing to show — but
   *  it is what the heartbeat reports and what a diagnostic overlay would read. */
  online: boolean;
  /** Set when the server says this token is finished. */
  tokenInvalid: boolean;
  /** The token was refused because this screen is connected to another TV. */
  otherDevice: boolean;
  lastFetchAt: number | null;
  /** A new bundle is held back because not all of its assets are cached yet. */
  waitingForAssets: boolean;
  /** While a bundle's files are downloading: how many of how many. Null otherwise. */
  assetProgress: AssetProgress | null;
  /** What that download is for: "board" is what a board needs before it goes
   *  up; "photos" is the rest of its albums, arriving behind a board already
   *  showing. */
  assetPhase: "board" | "photos" | null;
  errorCount: number;
};

const startedAt = Date.now();

export function useDisplay(token: string) {
  const [bundle, setBundle] = useState<BundleEnvelope | null>(null);
  const [status, setStatus] = useState<DisplayStatus>({
    source: "none",
    online: true,
    tokenInvalid: false,
    otherDevice: false,
    lastFetchAt: null,
    waitingForAssets: false,
    assetProgress: null,
    assetPhase: null,
    errorCount: 0,
  });

  // Read by the fetcher without making it depend on the rendered value: a
  // refetch triggered by realtime must send the ETag of whatever is on screen
  // right now, not whatever it was when the callback was created.
  const currentRef = useRef<BundleEnvelope | null>(null);
  const inFlightRef = useRef(false);
  /** Bumped whenever a different bundle is adopted, so a background download
   *  for the one before stops rather than filling the cache with its photos. */
  const generationRef = useRef(0);

  /** Put a bundle on screen, with its albums cut to the photos this device
   *  already holds (assets.ts, cachedView). `currentRef` keeps the whole
   *  bundle — it is what the next poll's ETag and comparison are about. */
  const adopt = useCallback(async (next: BundleEnvelope, source: "cache" | "network") => {
    generationRef.current += 1;
    currentRef.current = next;
    const view = await cachedView(next).catch(() => next);
    if (currentRef.current !== next) return;
    setBundle(view);
    setStatus((s) => ({ ...s, source, waitingForAssets: false }));
  }, []);

  /** Progress for the screen to show, at most four times a second — a board
   *  with hundreds of photos would otherwise re-render for every one. */
  const lastReportRef = useRef(0);
  const reporter = useCallback(
    (phase: "board" | "photos") => (progress: AssetProgress) => {
      const now = Date.now();
      if (now - lastReportRef.current < 250 && progress.done < progress.total) return;
      lastReportRef.current = now;
      setStatus((s) => ({ ...s, assetProgress: progress, assetPhase: phase }));
    },
    [],
  );

  /** Re-cut the albums on screen as more photos land. */
  const regrow = useCallback(async (whole: BundleEnvelope) => {
    const view = await cachedView(whole).catch(() => whole);
    if (currentRef.current === whole) setBundle(view);
  }, []);

  /** Download the rest of a board's photos behind it, growing its albums on
   *  screen every so often and once more at the end. Stops if another board
   *  is adopted meanwhile. */
  const fillIn = useCallback(
    async (whole: BundleEnvelope, urls: string[], generation: number, onProgress: (p: AssetProgress) => void) => {
      const stale = () => generationRef.current !== generation;
      let lastGrow = Date.now();
      await warmUrls(
        urls,
        (progress) => {
          if (stale()) return;
          onProgress(progress);
          if (Date.now() - lastGrow > GROW_MS) {
            lastGrow = Date.now();
            void regrow(whole);
          }
        },
        stale,
      );
      if (stale()) return;
      setStatus((s) => ({ ...s, assetProgress: null, assetPhase: null }));
      await regrow(whole);
      void evictUnusedAssets(whole);
    },
    [regrow],
  );

  /*
   * Fetch, and swap once what the board needs is cached.
   *
   * Returns nothing and throws nothing. Every failure path here ends with the
   * screen still showing what it was showing, because that is always better
   * than the alternatives.
   */
  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const headers: Record<string, string> = deviceHeaders();
      const held = currentRef.current;
      if (held?.contentHash) headers["if-none-match"] = `"${held.contentHash}"`;

      const response = await fetch(`/api/screen/${token}/bundle`, {
        headers,
        cache: "no-store",
      });

      if (response.status === 304) {
        setStatus((s) => ({ ...s, online: true, lastFetchAt: Date.now() }));
        return;
      }

      /*
       * The token is finished — §3a, and this is where rotation takes effect.
       *
       * The display is storage-first and cannot enforce rotation on itself: a
       * device that has booted once keeps presenting its old token whatever URL
       * somebody opens on it. The server is the only thing that can say no, and
       * this is the display doing as it is told — drop the stored token, drop
       * the bundle it belongs to, and come back as whatever the URL carries.
       */
      if (response.status === 410 || response.status === 401) {
        const reason = ((await response.json().catch(() => null)) as { code?: string } | null)?.code;
        await forgetBundle(token);
        setStatus((s) => ({ ...s, tokenInvalid: true, otherDevice: reason === "other_device", online: true }));
        return;
      }

      if (!response.ok) {
        // 503 while the first build lands, 502 if the database is unreachable.
        // Neither is a reason to stop showing a board.
        setStatus((s) => ({ ...s, online: true, lastFetchAt: Date.now() }));
        return;
      }

      const next = (await response.json()) as BundleEnvelope;
      if (held && next.contentHash === held.contentHash) {
        setStatus((s) => ({ ...s, online: true, lastFetchAt: Date.now() }));
        return;
      }

      setStatus((s) => ({ ...s, online: true, lastFetchAt: Date.now(), waitingForAssets: true }));

      // First what the board needs to go up: its pictures and the first few
      // photos of each album (assets.ts, warmOrder).
      const { first, rest } = warmOrder(next);
      const head = await warmUrls(first, reporter("board"));
      setStatus((s) => ({ ...s, assetProgress: null, assetPhase: null }));
      // Held back deliberately when a board is already showing: it keeps running
      // and the next poll tries again — a partially-cached bundle would show grey
      // holes where pictures belong the moment the network drops. With nothing
      // on screen yet, though, the board goes up anyway: a few pictures short
      // beats a black screen, and the next poll fetches the rest.
      if (!head.ready && held) {
        setStatus((s) => ({ ...s, waitingForAssets: true }));
        return;
      }

      await writeBundle(token, next);
      await adopt(next, "network");
      const generation = generationRef.current;
      // The board is up and polling carries on; the rest of the photos
      // download behind it, and the albums on screen grow as they land.
      inFlightRef.current = false;
      // Anything the head start missed is tried again with them.
      void fillIn(next, [...head.missing, ...rest], generation, reporter("photos"));
    } catch {
      setStatus((s) => ({
        ...s,
        online: false,
        errorCount: s.errorCount + 1,
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, [token, adopt, fillIn, reporter]);

  // ---- boot: cache first, then network ------------------------------------

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const cached = await readBundle(token);
      if (!cancelled && cached) {
        await adopt(cached, "cache");
        // A reboot in the middle of a download: pick it up where it stopped.
        // What's already cached counts as done straight away.
        const { first, rest } = warmOrder(cached);
        void fillIn(cached, [...first, ...rest], generationRef.current, reporter("photos"));
      }
      if (!cancelled) void refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [token, adopt, refresh, fillIn, reporter]);

  // ---- the service worker, which is what makes a cold offline boot work ----

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Scoped to /s/ so it never controls the dashboard. See public/sw.js.
    void navigator.serviceWorker.register("/sw.js", { scope: "/s/" }).catch(() => {
      // An insecure origin or a browser without support. The screen still works
      // online and still renders from IndexedDB on a warm reload; what is lost
      // is surviving a reboot during an outage.
    });
  }, []);

  // ---- §3d: realtime, and the poll that is there because realtime lies -----

  useEffect(() => {
    /*
     * "TV browsers drop websockets constantly and don't always fire reconnect
     * events. Belt and suspenders."
     *
     * The poll is not a fallback that runs when realtime fails — it runs
     * always, because the failure mode is a socket that is open and silent, and
     * nothing on the device can tell that apart from a quiet shul.
     */
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const screenId = bundle?.screen.id;
    if (!screenId) return;

    let dispose: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { subscribeToBundleChanges } = await import("./realtime");
      if (cancelled) return;
      dispose = subscribeToBundleChanges(token, screenId, () => void refresh());
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [token, bundle?.screen.id, refresh]);

  // ---- §3e: heartbeat -----------------------------------------------------

  useEffect(() => {
    const beat = () => {
      const held = currentRef.current;
      void fetch(`/api/screen/${token}/heartbeat`, {
        method: "POST",
        headers: deviceHeaders({ "content-type": "application/json" }),
        cache: "no-store",
        // keepalive so the last beat before a reload still lands.
        keepalive: true,
        body: JSON.stringify({
          bundleVersion: held?.bundleVersion ?? null,
          boardId: held?.playlist?.items[0]?.boardId ?? held?.boards[0]?.id ?? null,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          errorCount: 0,
        }),
      }).catch(() => {
        // A missed beat is a gap in a chart, not an incident. The next one
        // carries max_gap_seconds and the dashboard sees the outage.
      });
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [token]);

  // ---- §3e: the nightly reload --------------------------------------------

  useEffect(() => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(RELOAD_HOUR, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delay = next.getTime() - now.getTime() + Math.random() * RELOAD_JITTER_MS;
    const timer = setTimeout(() => location.reload(), delay);
    return () => clearTimeout(timer);
  }, []);

  return { bundle, status, refresh };
}
