"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { boardLength } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import type { BoardPhoto } from "@/lib/media/album-photos";
import type { WidgetRendererProps } from "../types";
import { albumSelectionKey, hasAlbumSelection, useSelectedPhotos } from "../media/albums";
import { PhotoEmpty } from "../media/PhotoEmpty";
import { cellAnimation, enterOffset, transitionTotal, type CollageTransition } from "../collage/transitions";
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

/** Resolve once an image is decoded, or has failed — a broken photo must not
 *  hold the gallery on the one before it forever. */
const decoded = new Map<string, Promise<void>>();
function preload(src: string): Promise<void> {
  let promise = decoded.get(src);
  if (!promise) {
    promise = new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => (typeof img.decode === "function" ? img.decode().then(resolve, resolve) : resolve());
      img.onerror = () => {
        decoded.delete(src);
        resolve();
      };
      img.src = src;
    });
    decoded.set(src, promise);
  }
  return promise;
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

type Stage = {
  current: BoardPhoto | null;
  previous: BoardPhoto | null;
  /** Bumps on every swap, so the layers remount and their animations replay. */
  generation: number;
  /** When the new photo starts arriving, after the old one has made room. */
  offset: number;
};

/**
 * Which photo is on screen, and which is leaving — the single-photo version of
 * the collage player (../collage/player.ts). The swap waits for the new photo
 * to be decoded, so it never arrives half-drawn, and the old photo stays until
 * its own exit has finished (../collage/transitions.ts: nothing pops).
 */
function useGalleryStage(target: BoardPhoto | undefined, mode: CollageTransition, speed: number): Stage {
  const [stage, setStage] = useState<Stage>({ current: target ?? null, previous: null, generation: 0, offset: 0 });
  const targetId = target?.assetId;

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    void preload(target.src).then(() => {
      if (cancelled) return;
      setStage((stage) => {
        if (stage.current?.assetId === target.assetId) return stage.current === target ? stage : { ...stage, current: target };
        // The very first photo arrives without a transition.
        if (!stage.current) return { current: target, previous: null, generation: stage.generation + 1, offset: 0 };
        return {
          current: target,
          previous: mode === "none" ? null : stage.current,
          generation: stage.generation + 1,
          offset: enterOffset(mode, 1, speed),
        };
      });
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the photo's identity: a re-render with the same photo is not a swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, target?.src]);

  // The old photo is removed once its exit — and the new one's entrance — is over.
  const { previous, generation } = stage;
  useEffect(() => {
    if (!previous) return;
    const timer = setTimeout(
      () => setStage((stage) => (stage.generation === generation ? { ...stage, previous: null } : stage)),
      transitionTotal(mode, 1, 1, speed) + 50,
    );
    return () => clearTimeout(timer);
  }, [previous, generation, mode, speed]);

  return stage;
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

  const reducedMotion = useReducedMotion();
  const mode: CollageTransition = reducedMotion ? "none" : config.transition;
  const index = ordered && ordered.length > 0 ? (second === null ? 0 : Math.floor(second / config.intervalSeconds) % ordered.length) : 0;
  const target = ordered && ordered.length > 0 ? ordered[index] : undefined;
  const upcoming = ordered && ordered.length > 1 ? ordered[(index + 1) % ordered.length] : undefined;
  const stage = useGalleryStage(target, mode, config.transitionSpeed);

  // Decode the next photo during this one's hold, so the swap is on time.
  useEffect(() => {
    if (upcoming) void preload(upcoming.src);
  }, [upcoming]);

  if (!hasAlbumSelection(config)) {
    return <PhotoEmpty canvas={canvas} message="Pick albums in this gallery’s settings." />;
  }
  if (ordered === undefined) {
    return <PhotoEmpty canvas={canvas} message="Loading photos…" />;
  }
  if (ordered.length === 0) {
    return <PhotoEmpty canvas={canvas} message="This album has no photos yet." />;
  }

  const current = stage.current ?? target!;
  // The photo a board opens on just shows; every later one transitions in.
  const first = stage.generation === 0;

  return (
    <div className="relative h-full w-full overflow-hidden" data-gallery>
      {stage.previous && (
        <PhotoLayer
          key={`${stage.generation}-leaving`}
          photo={stage.previous}
          fit={config.fit}
          animation={cellAnimation(mode, "leaving", 0, 1, 0, config.transitionSpeed)}
          role="leaving"
        />
      )}
      <PhotoLayer
        key={`${stage.generation}-entering`}
        photo={current}
        fit={config.fit}
        animation={first ? undefined : cellAnimation(mode, "entering", 0, 1, stage.offset, config.transitionSpeed)}
        role="entering"
      >
        {config.showCaption && current.caption && (
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
            {current.caption}
          </div>
        )}
      </PhotoLayer>
    </div>
  );
}

function PhotoLayer({
  photo,
  fit,
  animation,
  role,
  children,
}: {
  photo: BoardPhoto;
  fit: GalleryConfig["fit"];
  animation: string | undefined;
  role: "entering" | "leaving";
  children?: ReactNode;
}) {
  return (
    <div
      data-gallery-layer={role}
      data-photo-id={photo.assetId}
      className="absolute inset-0"
      style={{ zIndex: role === "entering" ? 1 : 0, animation, willChange: animation ? "opacity, transform" : undefined }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a media-proxy path,
          not a Next-optimizable asset, and the same <img> Image uses. */}
      <img
        src={photo.src}
        alt={photo.caption ?? ""}
        className="h-full w-full"
        style={{ objectFit: fit, objectPosition: "center" }}
        draggable={false}
      />
      {children}
    </div>
  );
}
