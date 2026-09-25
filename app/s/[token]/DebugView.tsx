"use client";

import { useEffect, useState } from "react";
import type { BoardFiles } from "@/lib/board-assets";
import type { DeviceFiles } from "@/lib/display/assets";
import { readMediaStats, type MediaStats } from "@/lib/display/debug";
import type { DisplayStorage } from "@/lib/display/useDisplay";
import { supportsContainerUnits } from "@/lib/board-theme";

/*
 * What the device is doing with its files — only with `?debug` on the URL,
 * for whoever is standing at the TV checking it. Never on a normal screen.
 *
 * The number to watch is "from the network": once the board has been through
 * one full cycle, it should stop going up — and after a reboot, stay at zero.
 */

const mb = (bytes: number | null) => (bytes === null ? "unknown" : `${(bytes / 1048576).toFixed(1)} MB`);

export function DebugView({
  files,
  snapshot,
  storage,
  bundleVersion,
}: {
  files: DeviceFiles;
  snapshot: BoardFiles;
  storage: DisplayStorage;
  bundleVersion: number;
}) {
  const [enabled, setEnabled] = useState(false);
  const [media, setMedia] = useState<MediaStats | null>(null);

  useEffect(() => {
    const on = new URLSearchParams(window.location.search).has("debug");
    const timer = setTimeout(() => setEnabled(on), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const read = async () => {
      const stats = await readMediaStats();
      if (!cancelled) setMedia(stats);
    };
    void read();
    const timer = setInterval(read, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !media) return;
    console.info(`[display] /m since boot: ${media.hits} from this device, ${media.network} from the network`);
  }, [enabled, media]);

  if (!enabled) return null;
  const stats = files.stats();
  void snapshot; // re-rendered as files land
  const rows: [string, string][] = [
    ["Bundle", String(bundleVersion)],
    ["Persistent storage", storage.persisted === null ? "unavailable" : storage.persisted ? "granted" : "not granted"],
    ["Storage used", `${mb(storage.usage)} of ${mb(storage.quota)}`],
    ["Photos from this device", media ? String(media.hits) : "no service worker"],
    ["Photos from the network", media ? String(media.network) : "no service worker"],
    ["Files cached", String(stats.cached)],
    ["Album files wanted", `${stats.wantedReady} of ${stats.wanted} here`],
    ["Failed, retrying", String(stats.failed)],
    ["Storage full", stats.full ? "yes" : "no"],
    // Which browser this TV really runs, and whether board sizes need the
    // pixel fallback on it (lib/board-theme.ts).
    ["Browser", navigator.userAgent],
    ["Board sizes", supportsContainerUnits() ? "native" : "pixel fallback (older browser)"],
  ];
  return (
    <div
      data-display-debug
      className="bg-ink/85 text-paper font-ui numeric pointer-events-none fixed top-[1.5vw] left-[1.5vw] z-50 rounded-[6px] px-[1vw] py-[0.8vw] text-[clamp(11px,0.9vw,18px)]"
    >
      <table>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="pr-[1vw] opacity-70">{label}</td>
              <td data-debug={label}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
