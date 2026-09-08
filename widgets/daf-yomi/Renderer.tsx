"use client";

import { useMemo, useRef } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { effectiveHebrewDate } from "@/lib/hebrew/civil-day";
import { dafYomiFor } from "@/lib/hebrew/daf-yomi";
import { formatDaf } from "@/lib/hebrew/format";
import { useSecond } from "@/lib/tick";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type DafYomiConfig } from "./manifest";

const ENGLISH_LINE_SCALE = 0.55;

export function Renderer({ config, canvas }: WidgetRendererProps<DafYomiConfig>) {
  const location = useBoardLocation();
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Same sunset-rollover Hebrew date Hebrew Date's own widget uses (plan.md
  // §5's toggle applies to "the Hebrew date," and the daf is keyed off that
  // same date) — kept independently configurable per widget for the same
  // reason Clock's timezone override is per instance, not shared: a board
  // author decides each widget's own honesty about the moment separately.
  const text = useMemo(() => {
    if (second === null || !location) return null;
    const hdate = effectiveHebrewDate(new Date(second * 1000), location, config.sunsetRollover);
    const daf = dafYomiFor(hdate);
    if (!daf) return null;
    return formatDaf(daf.daf, { script: config.script, numerals: config.numerals, nekudos: config.nekudos });
  }, [second, location, config.sunsetRollover, config.script, config.numerals, config.nekudos]);

  const isFit = config.sizingMode === "fit";
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 14,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: isFit,
    deps: [text?.hebrew, text?.english],
  });

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — Daf Yomi needs it." />;
  }

  const align =
    config.align === "center"
      ? "items-center text-center"
      : config.align === "right"
        ? "items-end text-right"
        : "items-start text-left";

  return (
    <div ref={boxRef} className={`flex h-full w-full flex-col justify-center ${align}`}>
      <div
        ref={contentRef}
        className="flex flex-col gap-[0.15em]"
        style={{ fontSize: isFit ? undefined : boardFontSize(config.size, canvas.width) }}
      >
        {text?.hebrew && (
          <span
            dir="rtl"
            lang="he"
            className="numeric font-semibold leading-tight"
            style={{ fontFamily: BOARD_FONTS.sefarim, fontSize: "1em" }}
          >
            {text.hebrew}
          </span>
        )}
        {text?.english && (
          <span className="numeric leading-tight opacity-80" style={{ fontSize: `${ENGLISH_LINE_SCALE}em` }}>
            {text.english}
          </span>
        )}
      </div>
    </div>
  );
}
