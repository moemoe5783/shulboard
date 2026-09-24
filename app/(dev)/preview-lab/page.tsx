"use client";

/*
 * Photo widgets rendered the way the editor and every preview render them:
 * through the real BoardRenderer with NO files provider — nothing on this page
 * knows about a device cache, so every photo must simply load and show.
 * What scripts/test-preview-photos.mjs drives.
 *
 * `?albums=late` hands the albums over a moment after the board mounts, the
 * way the editor's live query does (lib/media/useEditorAlbums.ts); the
 * default hands them over on the first render, the way a lab or a bundle does.
 * Both a Gallery and a Collage (Clean and Artsy) are on the board, plus an
 * Image widget and a photo background — every widget that shows photos.
 */

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BoardRenderer } from "@/components/board/BoardRenderer";
import { parseBoardDoc } from "@/lib/board-doc";
import type { BoardAlbums, BoardPhoto } from "@/lib/media/album-photos";

const CANVAS = { width: 1920, height: 1080 };
const BOARD_PX = { width: 1280, height: 720 };

function svgPhoto(hue: number, width: number, height: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="hsl(${hue} 45% 45%)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Photos with all three stored sizes, as real uploads have. */
const PHOTOS: BoardPhoto[] = Array.from({ length: 8 }, (_, i) => {
  const [w, h] = i % 3 === 0 ? [2400, 1600] : [1600, 2400];
  const variants = [
    { name: "thumb", scale: 400 / 2400 },
    { name: "display", scale: 1080 / 2400 },
    { name: "large", scale: 2160 / 2400 },
  ].map((size) => {
    const width = Math.round(w * size.scale);
    const height = Math.round(h * size.scale);
    const src = svgPhoto(i * 45, width, height);
    return { name: size.name, src, width, height, contentType: "image/svg+xml", bytes: src.length };
  });
  return {
    assetId: `preview-${i}`,
    src: variants[1].src,
    width: w,
    height: h,
    caption: null,
    addedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    displayUntil: null,
    variants,
  };
});
const ALBUMS: BoardAlbums = { "preview-album": PHOTOS };
const PICTURE = svgPhoto(200, 800, 600);

const album = { albumIds: ["preview-album"], intervalSeconds: 3, transition: "none" };

function PreviewLabInner() {
  const params = useSearchParams();
  const late = params.get("albums") === "late";
  const [albums, setAlbums] = useState<BoardAlbums | null>(late ? null : ALBUMS);
  useEffect(() => {
    if (!late) return;
    const timer = setTimeout(() => setAlbums(ALBUMS), 600);
    return () => clearTimeout(timer);
  }, [late]);

  const doc = parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { font: "assistant", ink: "ink", background: "surface" },
    background: { value: "image:preview-bg", src: PICTURE },
    widgets: [
      { id: "88888888-8888-4888-8888-888888888881", type: "gallery", x: 2, y: 2, w: 30, h: 45, z: 0, config: album },
      { id: "88888888-8888-4888-8888-888888888882", type: "collage", x: 34, y: 2, w: 30, h: 45, z: 0, config: { ...album, style: "clean" } },
      { id: "88888888-8888-4888-8888-888888888883", type: "collage", x: 66, y: 2, w: 32, h: 45, z: 0, config: { ...album, style: "artsy" } },
      { id: "88888888-8888-4888-8888-888888888884", type: "image", x: 2, y: 52, w: 30, h: 45, z: 0, config: { src: PICTURE, assetId: "" } },
    ],
  });

  return (
    <main style={{ padding: 16 }}>
      <div data-preview-board style={{ width: BOARD_PX.width, height: BOARD_PX.height }}>
        <BoardRenderer doc={doc} canvas={CANVAS} albums={albums} style={{ width: "100%", height: "100%" }} />
      </div>
    </main>
  );
}

export default function PreviewLab() {
  return (
    <Suspense>
      <PreviewLabInner />
    </Suspense>
  );
}
