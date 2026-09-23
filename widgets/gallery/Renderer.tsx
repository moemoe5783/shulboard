"use client";

import { useMemo } from "react";
import { boardLength } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import type { BoardPhoto } from "@/lib/media/album-photos";
import type { WidgetRendererProps } from "../types";
import { albumSelectionKey, hasAlbumSelection, useSelectedPhotos } from "../media/albums";
import { PhotoEmpty } from "../media/PhotoEmpty";
import { readGalleryConfig, type GalleryConfig } from "./manifest";

/** A tiny deterministic shuffle so "shuffle" order is stable across renders and
 *  between the editor and the display (SSR and CSR must agree) — seeded off the
 *  album id, Fisher-Yates over a mulberry32 stream. */
function shuffled(photos: BoardPhoto[], seed: string): BoardPhoto[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  const rand = () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...photos];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function Renderer({ config: raw, canvas }: WidgetRendererProps<GalleryConfig>) {
  const config = readGalleryConfig(raw);
  const photos = useSelectedPhotos(config);
  const albumKey = albumSelectionKey(config);
  const second = useSecond();

  const ordered = useMemo(
    () => (photos && config.order === "shuffle" ? shuffled(photos, albumKey) : photos),
    [photos, config.order, albumKey],
  );

  if (!hasAlbumSelection(config)) {
    return <PhotoEmpty canvas={canvas} message="Pick albums in this gallery’s settings." />;
  }
  if (ordered === undefined) {
    return <PhotoEmpty canvas={canvas} message="Loading photos…" />;
  }
  if (ordered.length === 0) {
    return <PhotoEmpty canvas={canvas} message="This album has no photos yet." />;
  }

  const index = second === null ? 0 : Math.floor(second / config.intervalSeconds) % ordered.length;
  const photo = ordered[index];

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- a media-proxy path,
          not a Next-optimizable asset, and the same <img> Image uses. */}
      <img
        key={photo.assetId}
        src={photo.src}
        alt={photo.caption ?? ""}
        className="h-full w-full"
        style={{ objectFit: config.fit, objectPosition: "center" }}
      />
      {config.showCaption && photo.caption && (
        <div
          className="absolute right-0 bottom-0 left-0"
          style={{
            background: "rgba(0, 0, 0, 0.45)",
            color: "#ffffff",
            fontSize: boardLength(28, canvas.width),
            padding: boardLength(12, canvas.width),
            lineHeight: 1.2,
          }}
        >
          {photo.caption}
        </div>
      )}
    </div>
  );
}
