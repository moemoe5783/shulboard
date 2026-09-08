"use client";

import { useMemo, useRef } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { effectiveHebrewDate } from "@/lib/hebrew/civil-day";
import { formatHebrewDate } from "@/lib/hebrew/format";
import { useSecond } from "@/lib/tick";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type HebrewDateConfig } from "./manifest";

/** The English line, when "both" scripts show, reads secondary to the
 *  Hebrew — same ratio Title uses for its own subtitle line. */
const ENGLISH_LINE_SCALE = 0.55;

export function Renderer({ config, canvas }: WidgetRendererProps<HebrewDateConfig>) {
  const location = useBoardLocation();
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Recomputed every tick rather than cached: the whole point of
  // sunsetRollover is that this can change mid-evening with nobody touching
  // the board, and the shared second-tick (lib/tick.ts) is already running
  // for every other time widget on the page — this adds no new timer.
  const text = useMemo(() => {
    if (second === null || !location) return null;
    const hdate = effectiveHebrewDate(new Date(second * 1000), location, config.sunsetRollover);
    return formatHebrewDate(hdate, {
      script: config.script,
      numerals: config.numerals,
      nekudos: config.nekudos,
      yearPrefix: config.yearPrefix,
    });
  }, [second, location, config.sunsetRollover, config.script, config.numerals, config.nekudos, config.yearPrefix]);

  const isFit = config.sizingMode === "fit";
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 16,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: isFit,
    deps: [text?.hebrew, text?.english],
  });

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — the Hebrew date needs it." />;
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
        {/*
          Frank Ruhl Libre, forced, for the whole Hebrew line — docs/tokens
          page's own specimen ("כ״ג אלול תשפ״ו") renders a full Hebrew date
          this way, gematria numerals and month name together, not just the
          digits. The English line stays in the board's own inherited theme
          font: it is plain Latin prose with no tabular-figure need.
        */}
        {text?.hebrew && (
          <span
            dir="rtl"
            lang="he"
            className="numeric font-semibold leading-none whitespace-nowrap"
            style={{ fontFamily: BOARD_FONTS.sefarim, fontSize: "1em" }}
          >
            {text.hebrew}
          </span>
        )}
        {text?.english && (
          <span
            className="numeric leading-none whitespace-nowrap opacity-80"
            style={{ fontSize: `${ENGLISH_LINE_SCALE}em` }}
          >
            {text.english}
          </span>
        )}
      </div>
    </div>
  );
}
