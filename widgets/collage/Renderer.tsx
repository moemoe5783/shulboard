"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useBoardAlbum } from "@/lib/board-assets";
import { boardLength } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import { collageCount, layoutCollage } from "@/lib/media/collage";
import type { WidgetRendererProps } from "../types";
import { PhotoEmpty } from "../media/PhotoEmpty";
import type { CollageConfig } from "./manifest";

export function Renderer({ config, canvas }: WidgetRendererProps<CollageConfig>) {
  const photos = useBoardAlbum(config.albumId);
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxAspect, setBoxAspect] = useState(16 / 9);

  // The frame shapes depend on the box's own aspect, so a wide frame in a tall
  // box is a different shape than in a wide one — measure it and re-match.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const rect = box.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setBoxAspect(rect.width / rect.height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const count = photos ? collageCount(config.count, photos.length) : 0;

  // Which photos this window shows. When there are more photos than frames and a
  // re-roll interval is set, the window slides by `count` each interval so the
  // whole album cycles through over time (plan.md §7's auto-fill).
  const selected = useMemo(() => {
    if (!photos || photos.length === 0 || count === 0) return [];
    let start = 0;
    if (config.intervalSeconds > 0 && photos.length > count && second !== null) {
      start = (Math.floor(second / config.intervalSeconds) * count) % photos.length;
    }
    return Array.from({ length: count }, (_, i) => photos[(start + i) % photos.length]);
  }, [photos, count, config.intervalSeconds, second]);

  const placements = useMemo(() => {
    if (selected.length === 0) return [];
    const aspects = selected.map((p) => (p.width && p.height ? p.width / p.height : 1));
    return layoutCollage({ count: selected.length, photoAspects: aspects, boxAspect });
  }, [selected, boxAspect]);

  if (!config.albumId) {
    return <PhotoEmpty canvas={canvas} message="Pick an album in this collage’s settings." />;
  }
  if (photos === undefined) {
    return <PhotoEmpty canvas={canvas} message="Loading photos…" />;
  }
  if (photos.length === 0) {
    return <PhotoEmpty canvas={canvas} message="This album has no photos yet." />;
  }

  const inset = boardLength(config.gutter / 2, canvas.width);
  const radius = boardLength(config.photoRadius, canvas.width);

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden">
      {placements.map((placement) => {
        const photo = selected[placement.photoIndex];
        if (!photo) return null;
        const { frame } = placement;
        return (
          <div
            key={`${placement.photoIndex}-${photo.assetId}`}
            className="absolute"
            style={{
              left: `${frame.x * 100}%`,
              top: `${frame.y * 100}%`,
              width: `${frame.w * 100}%`,
              height: `${frame.h * 100}%`,
              padding: inset,
              boxSizing: "border-box",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- proxy path,
                the same <img> Image and Gallery use. */}
            <img
              src={photo.src}
              alt={photo.caption ?? ""}
              className="h-full w-full"
              style={{ objectFit: "cover", objectPosition: "center", borderRadius: radius }}
            />
          </div>
        );
      })}
    </div>
  );
}
