"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BundleEnvelope } from "@/lib/bundle/types";
import { boardFileUrls, DeviceFiles, type AssetProgress } from "./assets";
import { loadFonts } from "./fonts";
import { resetMediaStats } from "./debug";
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
/** How long a board is up before files it no longer uses are cleared out —
 *  long enough for every widget on it to have declared its whole cycle. */
const EVICT_AFTER_MS = 30_000;

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
  /** What that download is for: a board's own pictures, before it goes up.
   *  (Album photos arrive behind a board already showing; the widgets' own
   *  progress is `files.wantedProgress()`.) */
  assetPhase: "board" | null;
  errorCount: number;
};

/** What the browser says about this device's storage — for the debug view. */
export type DisplayStorage = { persisted: boolean | null; usage: number | null; quota: number | null };

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

  /** The files on this device, and the album photos the board's widgets want
   *  downloaded (assets.ts). One for the life of the page. */
  const [files] = useState(() => new DeviceFiles());
  const filesSnapshot = useSyncExternalStore(files.subscribe, files.getSnapshot, files.getSnapshot);
  const loadedRef = useRef<Promise<void> | null>(null);
  const loadFiles = useCallback(() => (loadedRef.current ??= files.load()), [files]);

  /** Put a bundle on screen. */
  const adopt = useCallback((next: BundleEnvelope, source: "cache" | "network") => {
    currentRef.current = next;
    setBundle(next);
    setStatus((s) => ({ ...s, source, waitingForAssets: false }));
  }, []);

  /** Progress for the screen to show, at most four times a second — a board
   *  with hundreds of pictures would otherwise re-render for every one. */
  const lastReportRef = useRef(0);
  const reporter = useCallback(
    (progress: AssetProgress) => {
      const now = Date.now();
      if (now - lastReportRef.current < 250 && progress.done < progress.total) return;
      lastReportRef.current = now;
      setStatus((s) => ({ ...s, assetProgress: progress, assetPhase: "board" }));
    },
    [],
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

      // The board's own pictures first — on screen from its first second. Album
      // photos aren't waited for here: each Gallery and Collage asks for its own
      // (assets.ts) and shows a page only once all of it has arrived.
      await loadFiles();
      const pictures = await files.warmUrls(boardFileUrls(next), reporter);
      setStatus((s) => ({ ...s, assetProgress: null, assetPhase: null }));
      // Held back deliberately when a board is already showing: it keeps running
      // and the next poll tries again — a partially-cached bundle would show grey
      // holes where pictures belong the moment the network drops. With nothing
      // on screen yet, though, the board goes up anyway: a few pictures short
      // beats a black screen, and the next poll fetches the rest.
      if (!pictures.ready && held) {
        setStatus((s) => ({ ...s, waitingForAssets: true }));
        return;
      }

      // Its fonts loaded before it goes up, so the new board never shows a
      // moment of a fallback face (./fonts.ts).
      await loadFonts(next.fonts);
      await writeBundle(token, next);
      adopt(next, "network");
    } catch {
      setStatus((s) => ({
        ...s,
        online: false,
        errorCount: s.errorCount + 1,
      }));
    } finally {
      inFlightRef.current = false;
    }
  }, [token, adopt, files, loadFiles, reporter]);

  // ---- boot: cache first, then network ------------------------------------

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [cached] = await Promise.all([readBundle(token), loadFiles()]);
      // What's already here counts as ready straight away; the widgets ask for
      // anything else when they mount.
      if (!cancelled && cached) adopt(cached, "cache");
      if (!cancelled) void refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [token, adopt, refresh, loadFiles]);

  // ---- clearing out what the board no longer uses --------------------------

  useEffect(() => {
    if (!bundle) return;
    // Once per board, after its widgets have had time to declare their whole
    // cycles (assets.ts, evict); again on the next board, or after a reload.
    const timer = setTimeout(() => {
      if (currentRef.current === bundle) void files.evict(boardFileUrls(bundle));
    }, EVICT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [bundle, files]);

  // ---- storage the browser should keep --------------------------------------

  const [storage, setStorage] = useState<DisplayStorage>({ persisted: null, usage: null, quota: null });
  useEffect(() => {
    void (async () => {
      // Ask the browser not to clear this device's photos under storage
      // pressure. Some grant it outright, some decide by engagement, some
      // refuse; the answer is logged either way.
      const persisted = (await navigator.storage?.persist?.().catch(() => false)) ?? null;
      const estimate = (await navigator.storage?.estimate?.().catch(() => null)) ?? null;
      const mb = (bytes: number | undefined) => (bytes === undefined ? "?" : `${Math.round(bytes / 1048576)} MB`);
      console.info(
        `[display] persistent storage ${persisted ? "granted" : persisted === false ? "not granted" : "unavailable"}; ` +
          `using ${mb(estimate?.usage)} of ${mb(estimate?.quota)}`,
      );
      setStorage({ persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null });
    })();
    // Count /m requests from this boot on (public/sw.js), for the debug view.
    resetMediaStats();
  }, []);

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

  return { bundle, status, refresh, files, filesSnapshot, storage };
}
