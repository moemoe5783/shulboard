"use client";

/*
 * The REAL Collage widget, through BoardRenderer, on a synthetic album — what
 * scripts/test-collage-widget.mjs measures in a browser.
 *
 * Two boards render the same document at different pixel sizes. That is the
 * editor-versus-screen question in miniature: the editor draws the board at a
 * zoom, a screen at its own resolution, and the collage must lay out the same
 * in both. Two more boards hold an EMPTY album, one inside an editor surface
 * and one not, for the "Album is empty" hint that only the editor shows.
 *
 * The photos are SVGs of known aspect ratios, as data URLs — no network, no
 * Storage, and a crop or a stretch would show as a mismatch between an image's
 * own ratio and the box it renders in. They are board content (design.md §1b),
 * so their fills are whatever colour.
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BoardRenderer } from "@/components/board/BoardRenderer";
import { parseBoardDoc } from "@/lib/board-doc";
import { MIXES, randomPhotos } from "@/lib/collage/stress";
import { createRng } from "@/lib/collage/random";
import type { BoardAlbums, BoardPhoto } from "@/lib/media/album-photos";

const CANVAS = { width: 1920, height: 1080 };
export const COLLAGE_ID = "66666666-6666-4666-8666-666666666666";

function svgPhoto(width: number, height: number, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="hsl(${hue} 45% 45%)"/>` +
    `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="hsl(${hue} 45% 75%)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function album(seed: number, count: number, mix: string): BoardPhoto[] {
  return randomPhotos(createRng(seed), count, MIXES[mix] ?? MIXES.mixed).map((photo, i) => {
    const width = Math.round(photo.width / 2);
    const height = Math.round(photo.height / 2);
    const src = svgPhoto(width, height, (i * 47) % 360);
    return {
      assetId: `lab-${i}`,
      src,
      width,
      height,
      caption: null,
      addedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      displayUntil: null,
      variants: [{ name: "display", src, width, height, contentType: "image/svg+xml", bytes: src.length }],
    };
  });
}

function doc(
  albums: { albumId?: string; albumIds?: string[] },
  interval: number,
  transition: string,
  motion: { transitionOrder?: string; transitionSpeed?: number } = {},
  look: Record<string, string> = {},
) {
  return parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { font: "assistant", ink: "ink", background: "surface" },
    widgets: [
      {
        id: COLLAGE_ID,
        type: "collage",
        x: 5,
        y: 5,
        w: 90,
        h: 90,
        z: 0,
        config: { ...albums, ...motion, ...look, intervalSeconds: interval, transition, gutter: 12, density: "auto", order: "album" },
      },
    ],
  });
}

function Inner() {
  const params = useSearchParams();
  const seed = Number(params.get("seed") ?? 4);
  const count = Number(params.get("count") ?? 20);
  const mix = params.get("mix") ?? "mixed";
  const interval = Number(params.get("interval") ?? 3);
  const transition = params.get("transition") ?? "crossfade";
  const motion = {
    transitionOrder: params.get("order") ?? "reading",
    transitionSpeed: Number(params.get("speed") ?? 1),
  };

  // The Artsy style, from the query: ?style=artsy&artsyFrame=wood&…
  const look: Record<string, string | boolean> = {};
  for (const key of ["style", "artsyFrame", "artsyTilt", "artsyOverlap", "artsyBackdrop", "artsyShadow"]) {
    const value = params.get(key);
    if (value) look[key] = value;
  }
  if (params.get("artsyFasteners") === "false") look.artsyFasteners = false;

  const lab = album(seed, count, mix);
  // Two overlapping albums for the multi-album board: photos 4 and 5 are in
  // both, and one photo in the second ended long ago.
  const ended = { ...lab[10], assetId: "lab-ended", displayUntil: "2000-01-01" };
  const albums: BoardAlbums = { lab, empty: [], first: lab.slice(0, 6), second: [...lab.slice(4, 10), ended] };
  const full = doc({ albumId: "lab" }, interval, transition, motion, look as Record<string, string>);
  const empty = doc({ albumId: "empty" }, interval, transition);
  const multi = doc({ albumIds: ["first", "second"] }, interval, transition);
  const widgetProps = (widget: { id: string }) => ({ "data-widget-id": widget.id });

  return (
    <main className="bg-paper flex flex-col gap-4 p-4">
      <div data-lab-board="large" style={{ width: 960, height: 540, position: "relative" }}>
        <BoardRenderer doc={full} canvas={CANVAS} albums={albums} widgetProps={widgetProps} style={{ width: 960, height: 540 }} />
      </div>
      <div data-lab-board="small" style={{ width: 480, height: 270, position: "relative" }}>
        <BoardRenderer doc={full} canvas={CANVAS} albums={albums} widgetProps={widgetProps} style={{ width: 480, height: 270 }} />
      </div>
      <div data-lab-board="multi" style={{ width: 480, height: 270, position: "relative" }}>
        <BoardRenderer doc={multi} canvas={CANVAS} albums={albums} widgetProps={widgetProps} style={{ width: 480, height: 270 }} />
      </div>
      <div className="flex gap-4">
        <div data-lab-board="empty-display" style={{ width: 320, height: 180, position: "relative" }}>
          <BoardRenderer doc={empty} canvas={CANVAS} albums={albums} widgetProps={widgetProps} style={{ width: 320, height: 180 }} />
        </div>
        <div data-lab-board="empty-editor" data-editor-surface style={{ width: 320, height: 180, position: "relative" }}>
          <BoardRenderer doc={empty} canvas={CANVAS} albums={albums} widgetProps={widgetProps} style={{ width: 320, height: 180 }} />
        </div>
      </div>
    </main>
  );
}

export default function CollageWidgetLabPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
