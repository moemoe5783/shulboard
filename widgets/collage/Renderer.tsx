"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { boardLength } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import type { WidgetRendererProps } from "../types";
import { albumSelectionKey, hasAlbumSelection, useSelectedPhotos } from "../media/albums";
import { PhotoEmpty } from "../media/PhotoEmpty";
import { resolveDesignUnits } from "../useFitFontSize";
import { readCollageConfig, type CollageConfig } from "./manifest";
import { CollagePlayer, type PlannedPage, type PlayerSnapshot } from "./player";
import { cellAnimation, readingOrder, type CollageTransition } from "./transitions";

/*
 * The collage on the board. The layout comes from lib/collage — the same
 * module the editor, every screen and the tests run — and the cycle from
 * ./player.ts. This file only measures the box, feeds the player, and draws
 * what it says: each photo at exactly its cell, `object-fit: contain`, so
 * nothing is ever cropped, with the cells in percentages of the box so the
 * layout scales with whatever resolution the screen really is.
 *
 * THE BOX IS MEASURED IN DESIGN UNITS, not pixels — the editor draws the board
 * at a zoom, a 4K screen at twice a 1080p one, and the layout must be the same
 * in all of them. Resizing re-lays the collage after a 150ms pause so a drag
 * previews live without rebuilding on every frame.
 *
 * EDITOR CONTROLS without an editor prop: the Settings panel's "Next page" and
 * "Pause" dispatch DOM events on this element (`data-collage`), and the state
 * is written back as data attributes — the same plain-DOM channel the panel
 * already reads fit sizes through. The display never sends them.
 */

const RESIZE_DEBOUNCE_MS = 150;

type Measured = { design: { width: number; height: number }; px: { width: number; height: number } };

function useCollageBox(ref: RefObject<HTMLDivElement | null>, canvasWidth: number): Measured | null {
  const [measured, setMeasured] = useState<Measured | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;

    const read = () => {
      const px = { width: el.clientWidth, height: el.clientHeight };
      if (px.width === 0 || px.height === 0) return;
      const design = {
        width: Math.round(resolveDesignUnits(px.width, canvasWidth, el)),
        height: Math.round(resolveDesignUnits(px.height, canvasWidth, el)),
      };
      setMeasured((previous) =>
        previous &&
        previous.design.width === design.width &&
        previous.design.height === design.height &&
        previous.px.width === px.width &&
        previous.px.height === px.height
          ? previous
          : { design, px },
      );
    };

    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        read();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [ref, canvasWidth]);

  return measured;
}

/** Whether the viewer has asked for less motion. Pages still change — that is
 *  the content — but instantly. */
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

export function Renderer({ config: raw, canvas }: WidgetRendererProps<CollageConfig>) {
  const reducedMotion = useReducedMotion();
  const stored = readCollageConfig(raw);
  const config: CollageConfig = reducedMotion ? { ...stored, transition: "none" } : stored;
  const album = useSelectedPhotos(config);
  const second = useSecond();
  const rootRef = useRef<HTMLDivElement>(null);
  const measured = useCollageBox(rootRef, canvas.width);

  const [player] = useState(() => new CollagePlayer());
  const snapshot = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);

  useEffect(() => () => player.dispose(), [player]);

  useEffect(() => {
    if (!measured || !album) return;
    player.setInputs({
      photos: album,
      box: measured.design,
      boxPx: measured.px,
      dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
      config,
      albumKey: albumSelectionKey(config),
    });
    // `config` is re-read from `raw` each render; key the effect on what it is
    // made of so a render with the same settings doesn't re-feed the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, measured, album, JSON.stringify(config)]);

  useEffect(() => {
    if (second !== null) player.tick(second);
  }, [player, second]);

  // The editor's controls (widgets/collage/Settings.tsx).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const next = () => player.next();
    const toggle = () => player.togglePlaying();
    el.addEventListener("collage:next", next);
    el.addEventListener("collage:toggle", toggle);
    return () => {
      el.removeEventListener("collage:next", next);
      el.removeEventListener("collage:toggle", toggle);
    };
  }, [player]);

  const hint = hintFor(config, album, snapshot);

  return (
    <div
      ref={rootRef}
      data-collage
      data-collage-playing={snapshot.playing ? "true" : "false"}
      data-collage-page={snapshot.current ? snapshot.current.index + 1 : undefined}
      data-collage-cycle={snapshot.current ? snapshot.current.cycle + 1 : undefined}
      data-collage-count={snapshot.current ? snapshot.current.cells.length : undefined}
      className="relative h-full w-full overflow-hidden"
      style={{ backgroundColor: config.leftoverColor || undefined }}
    >
      {hint ? (
        // Editor-only: on a screen, an empty or unconfigured collage shows
        // nothing at all (the editor's canvas reveals [data-editor-hint]).
        <PhotoEmpty canvas={canvas} message={hint} editorOnly />
      ) : (
        <>
          {snapshot.previous && (
            <Layer key={snapshot.previous.key} page={snapshot.previous} config={config} canvas={canvas} role="leaving" offset={0} />
          )}
          {snapshot.current && (
            <Layer
              key={snapshot.current.key}
              page={snapshot.current}
              config={config}
              canvas={canvas}
              role="entering"
              offset={snapshot.currentOffset}
            />
          )}
        </>
      )}
    </div>
  );
}

function hintFor(
  config: CollageConfig,
  album: ReturnType<typeof useSelectedPhotos>,
  snapshot: PlayerSnapshot,
): string | null {
  if (!hasAlbumSelection(config)) return "Pick albums in this collage’s settings.";
  if (album === undefined) return "Loading photos…";
  if (album.length === 0) return "Album is empty";
  if (snapshot.unsized) return "These photos are still being measured. Open the album in Media once to finish.";
  return null;
}

/** One page of photos. Each photo animates on its own (./transitions.ts): in
 *  reading order for the one-by-one modes, all together for the whole-page
 *  ones. A leaving page animates away too, so nothing is left to pop. */
function Layer({
  page,
  config,
  canvas,
  role,
  offset,
}: {
  page: PlannedPage;
  config: CollageConfig;
  canvas: { width: number };
  role: "entering" | "leaving";
  /** For an entering page: when it starts, after the old page has made room. */
  offset: number;
}) {
  const mode = config.transition as CollageTransition;
  const order = readingOrder(page.cells);

  const radius = config.photoRadius > 0 ? boardLength(config.photoRadius, canvas.width) : undefined;
  const photoStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block",
    borderRadius: radius,
    boxSizing: "border-box",
  };
  if (config.photoFrame === "border") {
    photoStyle.border = `${boardLength(2, canvas.width)} solid color-mix(in srgb, currentColor 35%, transparent)`;
  }
  if (config.photoFrame === "shadow") photoStyle.boxShadow = "0 0.3cqw 1.2cqw rgba(0, 0, 0, 0.3)";

  return (
    <div data-collage-layer={role} className="absolute inset-0" style={{ zIndex: role === "entering" ? 1 : 0 }}>
      {page.cells.map((cell, i) => (
        <div
          key={cell.id}
          data-photo-id={cell.id}
          className="absolute"
          style={{
            left: `${cell.left}%`,
            top: `${cell.top}%`,
            width: `${cell.width}%`,
            height: `${cell.height}%`,
            animation: cellAnimation(mode, role, order[i], page.cells.length, offset),
            willChange: mode === "none" ? undefined : "opacity, transform",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a media-proxy
              path, preloaded by the player, the same <img> Image and Gallery use. */}
          <img src={cell.src} alt={cell.alt} style={photoStyle} draggable={false} />
        </div>
      ))}
    </div>
  );
}
