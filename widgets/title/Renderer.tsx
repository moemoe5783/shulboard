"use client";

import { useRef } from "react";
import { boardFontSize } from "@/lib/board-theme";
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

  // Fit (the default, manifest.ts): the box is authoritative and the font size
  // is computed. contentRef wraps both lines so they're measured and fitted
  // together; the title span inherits the fitted size and the subtitle scales
  // off it in em, so one search sizes both at once rather than fitting them
  // independently against each other. Fixed and Hug set `size` instead.
  const isFit = (config.sizingMode ?? "fit") === "fit";
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 8,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: isFit,
    deps: [config.text, config.subtitle, config.subtitleScale],
  });

  return (
    <div ref={boxRef} className={`flex h-full w-full flex-col justify-center ${align}`}>
      <div
        ref={contentRef}
        className="flex flex-col gap-[0.4em]"
        style={{ fontSize: isFit ? undefined : boardFontSize(config.size ?? 96, canvas.width), overflowWrap: isFit ? undefined : "anywhere" }}
      >
        {/* dir="auto": a Hebrew-first title lays out right to left, an
            English-first one left to right. */}
        <span dir="auto" className="leading-tight" style={{ fontWeight: "var(--board-weight-main, var(--board-weight-semibold, 600))" }}>
          {config.text}
        </span>

        {config.subtitle && (
          <span
            dir="auto"
            className="leading-tight opacity-70"
            // The subtitle is regular text in the title's face.
            style={{ fontSize: `${config.subtitleScale}em` }}
          >
            {config.subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
