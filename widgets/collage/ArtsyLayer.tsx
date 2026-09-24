"use client";

import type { CSSProperties } from "react";
import { createRng, hashSeed } from "@/lib/collage/random";
import { matStyle, paperStyle, pinStyle, printShadow, tapeStyle } from "./artsy-style";
import type { CollageConfig } from "./manifest";
import type { PlannedPage } from "./player";
import { cellAnimation, type CollageTransition } from "./transitions";

/*
 * One page of the Artsy collage (lib/collage/artsy lays it out): each print a
 * positioned wrapper that carries the page transition, a rotor inside it that
 * carries the tilt, and inside that the paper or frame, the photo and any tape
 * or pin — all placed in percentages of the print's own outer rect, so it
 * scales with the board like everything else.
 *
 * Two elements rather than one because both the transition and the tilt are
 * transforms, and one element can only have one: the dealt-in drop animates
 * the wrapper while the rotor keeps its angle throughout.
 *
 * The photo is `object-fit: contain` in a rect that is already its exact
 * shape, so there are no bars and nothing is cropped (spec §6).
 */

const pct = (rect: { left: number; top: number; width: number; height: number }): CSSProperties => ({
  position: "absolute",
  left: `${rect.left}%`,
  top: `${rect.top}%`,
  width: `${rect.width}%`,
  height: `${rect.height}%`,
});

export function ArtsyLayer({
  page,
  config,
  mode,
  canvas,
  role,
  offset,
}: {
  page: PlannedPage;
  config: CollageConfig;
  mode: CollageTransition;
  canvas: { width: number };
  role: "entering" | "leaving";
  offset: number;
}) {
  const shadow = printShadow(config.artsyShadow, canvas.width);
  // Shuffle sends each print off its own way, seeded by the page so every
  // screen plays it the same.
  const rng = createRng(hashSeed("shuffle", page.key));

  return (
    <div data-collage-layer={role} className="absolute inset-0" style={{ zIndex: role === "entering" ? 1 : 0 }}>
      {page.cells.map((cell) => {
        const artsy = cell.artsy;
        if (!artsy) return null;
        const angle = rng() * Math.PI * 2;
        const vars = {
          "--shuffle-x": `${Math.round(Math.cos(angle) * 60)}%`,
          "--shuffle-y": `${Math.round(Math.sin(angle) * 60)}%`,
          "--shuffle-r": `${Math.round((rng() - 0.5) * 24)}deg`,
        } as CSSProperties;
        const framed = artsy.style === "wood" || artsy.style === "gallery";
        return (
          <div
            key={cell.id}
            data-photo-id={cell.id}
            data-artsy-print={artsy.style}
            style={{
              ...pct(cell),
              ...vars,
              zIndex: artsy.zIndex,
              animation: cellAnimation(mode, role, artsy.zOrder, page.cells.length, offset, config.transitionSpeed),
              willChange: mode === "none" ? undefined : "opacity, transform",
            }}
          >
            <div className="absolute inset-0" style={{ transform: artsy.rotation ? `rotate(${artsy.rotation}deg)` : undefined }}>
              <div
                style={{
                  ...pct(artsy.paper),
                  ...paperStyle(artsy.style, artsy.variation, artsy.hero, artsy.frameUnits, canvas.width),
                  boxShadow: shadow,
                }}
              >
                {framed && <div className="absolute inset-0" style={matStyle(canvas.width)} />}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element -- a media-proxy
                  path, preloaded by the player, the same <img> the Clean style uses. */}
              <img
                src={cell.src}
                alt={cell.alt}
                draggable={false}
                style={{
                  ...pct(artsy.image),
                  objectFit: "contain",
                  display: "block",
                  // A hairline where photo meets paper, as a real print has.
                  boxShadow: framed ? "0 0 0 1px rgba(0,0,0,0.12)" : "0 0 0 1px rgba(0,0,0,0.05)",
                }}
              />
              {artsy.fasteners.map((f, i) => (
                <div
                  key={i}
                  data-fastener={f.kind}
                  style={{
                    ...pct(f),
                    transform: f.angle ? `rotate(${f.angle}deg)` : undefined,
                    ...(f.kind === "tape" ? tapeStyle(f.variant, canvas.width) : pinStyle(f.variant, canvas.width)),
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
