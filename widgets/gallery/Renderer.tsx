"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useBoardFiles } from "@/lib/board-assets";
import { boardLength } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import type { BoardPhoto } from "@/lib/media/album-photos";
import { fittedWidth, photoVariants, pickVariant, readyVariant } from "@/lib/media/variant-choice";
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

/** A photo, and the file of it to draw. */
type Shown = { photo: BoardPhoto; src: string };

type Stage = {
  current: Shown | null;
  previous: Shown | null;
  /** Bumps on every swap, so the layers remount and their animations replay. */
  generation: number;
  /** When the new photo starts arriving, after the old one has made room. */
  offset: number;
  /** The second the photo on screen went up — for how long it has waited on
   *  the next one. */
  shownAt: number | null;
};

/**
 * Which photo is on screen, and which is leaving — the single-photo version of
 * the collage player (../collage/player.ts). The swap waits for the new photo
 * to be decoded, so it never arrives half-drawn, and the old photo stays until
 * its own exit has finished (../collage/transitions.ts: nothing pops).
 *
 * `choose` picks what should be on screen from what is — it's given the photo
 * showing and when it went up, so it can hold that photo while the next one's
 * file is still on its way.
 */
function useGalleryStage(
  choose: (current: Shown | null, shownAt: number | null) => Shown | undefined,
  second: number | null,
  mode: CollageTransition,
  speed: number,
): { stage: Stage; target: Shown | undefined } {
  const [stage, setStage] = useState<Stage>({ current: null, previous: null, generation: 0, offset: 0, shownAt: null });
  const target = choose(stage.current, stage.shownAt);
  const targetId = target?.photo.assetId;

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    void preload(target.src).then(() => {
      if (cancelled) return;
      setStage((stage) => {
        if (stage.current?.photo.assetId === target.photo.assetId) {
          return stage.current.src === target.src && stage.current.photo === target.photo ? stage : { ...stage, current: target };
        }
        // The very first photo arrives without a transition.
        if (!stage.current) return { current: target, previous: null, generation: stage.generation + 1, offset: 0, shownAt: second };
        return {
          current: target,
          previous: mode === "none" ? null : stage.current,
          generation: stage.generation + 1,
          offset: enterOffset(mode, 1, speed),
          shownAt: second,
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

  return { stage, target };
}

/**
 * The box in real pixels, times the pixel ratio — what decides which stored
 * size is sharp here. Null until measured.
 *
 * Measured through a callback ref, so it measures whenever the box element
 * appears. The gallery draws a placeholder instead of its box until its
 * albums arrive, which in the editor is a moment after it mounts; measuring
 * only on mount found no element then and never looked again, and the gallery
 * stayed empty in the editor.
 */
function useBoxPixels(): [(el: HTMLDivElement | null) => void, { width: number; height: number } | null] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!el) return;
    const read = () => {
      const dpr = window.devicePixelRatio || 1;
      const next = { width: Math.round(el.clientWidth * dpr), height: Math.round(el.clientHeight * dpr) };
      if (next.width === 0 || next.height === 0) return;
      setBox((previous) => (previous && previous.width === next.width && previous.height === next.height ? previous : next));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, box];
}

/** A photo shown this many intervals without the next one arriving gives way
 *  to the next photo that IS here — the collage's rule (../collage/player.ts). */
const HOLD_INTERVALS = 3;

let galleries = 0;

export function Renderer({ config: raw, canvas }: WidgetRendererProps<GalleryConfig>) {
  const config = readGalleryConfig(raw);
  const photos = useSelectedPhotos(config);
  const albumKey = albumSelectionKey(config);
  const second = useSecond();
  const files = useBoardFiles();
  const [rootRef, boxPx] = useBoxPixels();
  const [owner] = useState(() => `gallery-${(galleries += 1)}`);

  const ordered = useMemo(
    () => (photos && config.order === "shuffle" ? shuffled(photos, albumKey) : photos),
    [photos, config.order, albumKey],
  );

  // How wide each photo draws in this box — what picks its file.
  const needed = useMemo(() => {
    const out = new Map<string, number>();
    if (!ordered || !boxPx) return out;
    for (const photo of ordered) out.set(photo.assetId, fittedWidth(photo, boxPx, config.fit));
    return out;
  }, [ordered, boxPx, config.fit]);

  const reducedMotion = useReducedMotion();
  const mode: CollageTransition = reducedMotion ? "none" : config.transition;
  const count = ordered?.length ?? 0;
  const index = count > 0 ? (second === null ? 0 : Math.floor(second / config.intervalSeconds) % count) : 0;

  // Tell the board which files this gallery shows, starting with the one due
  // now: every photo in the order it comes round (lib/board-assets.tsx).
  useEffect(() => {
    if (!files.gated || !ordered || !boxPx) return;
    const srcs: string[] = [];
    for (let i = 0; i < ordered.length; i += 1) {
      const photo = ordered[(index + i) % ordered.length];
      srcs.push(pickVariant(photoVariants(photo), needed.get(photo.assetId) ?? boxPx.width).src);
    }
    files.want(owner, srcs, true);
  }, [files, ordered, boxPx, needed, index, owner]);
  useEffect(() => () => files.want(owner, [], true), [files, owner]);

  // The file to draw for a photo: its size for this box, or a bigger copy
  // already on the device; undefined when neither is here yet.
  const fileFor = (photo: BoardPhoto): Shown | undefined => {
    const variant = readyVariant(photoVariants(photo), needed.get(photo.assetId) ?? boxPx?.width ?? 0, files.gated ? files.isReady : null);
    return variant ? { photo, src: variant.src } : undefined;
  };

  // The photo due now, if it's here. If not, the one on screen stays — until
  // it has been up three intervals, when the next photo that is here takes
  // over rather than one photo holding the wall forever.
  const choose = (onScreen: Shown | null, shownAt: number | null): Shown | undefined => {
    if (!ordered || count === 0 || !boxPx) return undefined;
    const due = fileFor(ordered[index]);
    if (due) return due;
    const stillInAlbum = onScreen !== null && ordered.some((photo) => photo.assetId === onScreen.photo.assetId);
    const heldFor = shownAt !== null && second !== null ? second - shownAt : 0;
    if (stillInAlbum && heldFor < HOLD_INTERVALS * config.intervalSeconds) return onScreen;
    for (let i = 1; i < count; i += 1) {
      const next = fileFor(ordered[(index + i) % count]);
      if (next) return next;
    }
    return stillInAlbum ? onScreen : undefined;
  };
  const upcoming = ordered && count > 1 ? fileFor(ordered[(index + 1) % count]) : undefined;
  const { stage, target } = useGalleryStage(choose, second, mode, config.transitionSpeed);

  // Decode the next photo during this one's hold, so the swap is on time.
  useEffect(() => {
    if (upcoming) void preload(upcoming.src);
  }, [upcoming?.src]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasAlbumSelection(config)) {
    return <PhotoEmpty canvas={canvas} message="Pick albums in this gallery’s settings." />;
  }
  if (ordered === undefined) {
    return <PhotoEmpty canvas={canvas} message="Loading photos…" />;
  }
  if (ordered.length === 0) {
    return <PhotoEmpty canvas={canvas} message="This album has no photos yet." />;
  }

  const current = stage.current ?? target;
  // The photo a board opens on just shows; every later one transitions in.
  const first = stage.generation === 0;

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden" data-gallery>
      {stage.previous && (
        <PhotoLayer
          key={`${stage.generation}-leaving`}
          shown={stage.previous}
          fit={config.fit}
          animation={cellAnimation(mode, "leaving", 0, 1, 0, config.transitionSpeed)}
          role="leaving"
        />
      )}
      {current && (
        <PhotoLayer
          key={`${stage.generation}-entering`}
          shown={current}
          fit={config.fit}
          animation={first ? undefined : cellAnimation(mode, "entering", 0, 1, stage.offset, config.transitionSpeed)}
          role="entering"
        >
          {config.showCaption && current.photo.caption && (
            <div
              className="absolute right-0 bottom-0 left-0"
              // A caption in Hebrew reads right to left, one in English left
              // to right — its own direction, from its own text.
              dir="auto"
              style={{
                unicodeBidi: "plaintext",
                background: "rgba(0, 0, 0, 0.45)",
                color: "#ffffff",
                fontSize: boardLength(config.captionSize, canvas.width),
                padding: boardLength(config.captionPadding, canvas.width),
                lineHeight: "var(--leading-tight, 1.25)",
              }}
            >
              {current.photo.caption}
            </div>
          )}
        </PhotoLayer>
      )}
    </div>
  );
}

function PhotoLayer({
  shown,
  fit,
  animation,
  role,
  children,
}: {
  shown: Shown;
  fit: GalleryConfig["fit"];
  animation: string | undefined;
  role: "entering" | "leaving";
  children?: ReactNode;
}) {
  return (
    <div
      data-gallery-layer={role}
      data-photo-id={shown.photo.assetId}
      className="absolute inset-0"
      style={{ zIndex: role === "entering" ? 1 : 0, animation, willChange: animation ? "opacity, transform" : undefined }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a media-proxy path,
          not a Next-optimizable asset, and the same <img> Image uses. */}
      <img
        src={shown.src}
        alt={shown.photo.caption ?? ""}
        className="h-full w-full"
        style={{ objectFit: fit, objectPosition: "center" }}
        draggable={false}
      />
      {children}
    </div>
  );
}
