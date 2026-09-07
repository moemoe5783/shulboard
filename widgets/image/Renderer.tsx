"use client";

import { boardLength } from "@/lib/board-theme";
import type { WidgetRendererProps } from "../types";
import type { ImageConfig } from "./manifest";

/*
 * One picture. Shared by the editor and the display route.
 *
 * A plain <img>, not next/image. Board assets are arbitrary URLs from Supabase
 * Storage with variants already generated on upload (§6), so the optimiser has
 * nothing to add and would need every future storage host in its config; and on
 * the display route the service worker is what caches these, cache-first, which
 * a rewritten /_next/image URL would sit in front of.
 */

export function Renderer({ config, canvas }: WidgetRendererProps<ImageConfig>) {
  const radius = boardLength(config.radius, canvas.width);

  if (!config.src) {
    /*
     * An honest empty frame. A board with a picture missing should look like a
     * board with a picture missing, not like a broken one — and never like a
     * gradient standing in for a photograph.
     *
     * The copy instructs rather than reporting a void, which design.md §5 asks
     * of an empty state and which "No picture yet" was not. It has to work in
     * both places this renders, so it says what needs doing without naming a
     * panel that only exists in the editor.
     */
    return (
      <div
        className="border-current/25 flex h-full w-full items-center justify-center border border-dashed opacity-60"
        style={{ borderRadius: radius }}
      >
        <span style={{ fontSize: boardLength(28, canvas.width) }}>
          Choose a picture for this box
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the note above.
    <img
      src={config.src}
      alt={config.alt}
      className="h-full w-full"
      style={{
        objectFit: config.fit,
        // The focal point decides which part of the photo survives the crop.
        objectPosition: `${config.focalX * 100}% ${config.focalY * 100}%`,
        borderRadius: radius,
      }}
    />
  );
}
