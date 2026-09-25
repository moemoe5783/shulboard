"use client";

import { useRef } from "react";
import { boardFontSize } from "@/lib/board-theme";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type TitleConfig } from "./manifest";

export function Renderer({ config, canvas }: WidgetRendererProps<TitleConfig>) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // "start" (the default): each line fills the width and aligns to its own
  // language's start, so a Hebrew title sits right and an English one left.
  const align =
    config.align === "center"
      ? "items-center text-center"
      : config.align === "right"
        ? "items-end text-right"
        : config.align === "left"
          ? "items-start text-left"
          : "items-stretch text-start";

  // Fit (the default, manifest.ts): the box is authoritative and the font size
  // is computed. contentRef wraps both lines so they're measured and fitted
  // together; the title span inherits the fitted size and the subtitle scales
  // off it in em, so one search sizes both at once rather than fitting them
  // independently against each other. Fixed and Hug set `size` instead.
  const isFit = (config.sizingMode ?? "fit") === "fit";
  const isHug = config.sizingMode === "hug";
  // Fixed: the typed size is the most it gets — a box too small for it shrinks
  // the title to fit rather than cutting it off.
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 8,
    maxFontSize: isFit ? (manifest.sizing.maxFontSize ?? 400) : (config.size ?? 96),
    canvasWidth: canvas.width,
    enabled: !isHug,
    deps: [config.text, config.subtitle, config.subtitleScale, config.size, config.sizingMode],
  });

  return (
    <div ref={boxRef} className={`flex h-full w-full flex-col justify-center ${align}`}>
      <div
        ref={contentRef}
        className="flex flex-col gap-[0.4em]"
        style={{ fontSize: isHug ? boardFontSize(config.size ?? 96, canvas.width) : undefined, overflowWrap: isFit ? undefined : "anywhere" }}
      >
        {/* dir="auto": a Hebrew-first title lays out right to left, an
            English-first one left to right. */}
        <span dir="auto" className="leading-tight" style={{ unicodeBidi: "plaintext", fontWeight: "var(--board-weight-main, var(--board-weight-semibold, 600))" }}>
          {config.text}
        </span>

        {config.subtitle && (
          <span
            dir="auto"
            className="leading-tight opacity-70"
            // The subtitle is regular text in the title's face, with its own
            // direction.
            style={{ fontSize: `${config.subtitleScale}em`, unicodeBidi: "plaintext" }}
          >
            {config.subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
