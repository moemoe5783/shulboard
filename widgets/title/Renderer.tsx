"use client";

import { useRef } from "react";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type TitleConfig } from "./manifest";

export function Renderer({ config, canvas }: WidgetRendererProps<TitleConfig>) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const align =
    config.align === "center"
      ? "items-center text-center"
      : config.align === "right"
        ? "items-end text-right"
        : "items-start text-left";

  // Title is always `fit` (manifest.ts) — the box is authoritative and the
  // font size is computed, never read from config. contentRef wraps both
  // lines so they're measured and fitted together; the title span inherits
  // the fitted size and the subtitle scales off it in em, so one search sizes
  // both at once rather than fitting them independently against each other.
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 8,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: true,
    deps: [config.text, config.subtitle, config.subtitleScale],
  });

  return (
    <div ref={boxRef} className={`flex h-full w-full flex-col justify-center ${align}`}>
      <div ref={contentRef} className="flex flex-col gap-[0.4em]">
        <span className="font-semibold leading-tight">{config.text}</span>

        {config.subtitle && (
          <span
            className="leading-tight opacity-70"
            style={{ fontSize: `${config.subtitleScale}em` }}
          >
            {config.subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
