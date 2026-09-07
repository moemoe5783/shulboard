"use client";

import { useMemo, useRef } from "react";
import { useSecond } from "@/lib/tick";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type ClockConfig } from "./manifest";

export function Renderer({ config, canvas }: WidgetRendererProps<ClockConfig>) {
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);

  const format = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        ...(config.showSeconds ? { second: "2-digit" as const } : {}),
        hour12: config.hour12,
        ...(config.timeZone ? { timeZone: config.timeZone } : {}),
      }),
    [config.hour12, config.showSeconds, config.timeZone],
  );

  const text = second === null ? " " : format.format(new Date(second * 1000));
  const isFit = config.sizingMode === "fit";

  // Only searches while in `fit` mode — a `fixed` clock (the default) has
  // nothing running in the background for the months it sits on a screen.
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 24,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: isFit,
    deps: [text],
  });

  const align =
    config.align === "center" ? "justify-center" : config.align === "right" ? "justify-end" : "justify-start";

  return (
    <div ref={boxRef} className={`flex h-full w-full items-center ${align}`}>
      {/*
        Frank Ruhl Libre, forced, rather than the board's own theme font —
        docs/sizing.md §4. It's the only face with real tabular figures
        (design.md's own measurement table: Assistant's tabular-nums spread is
        unchanged, a measured no-op), and a clock is the one element whose
        digit count changes every single minute it's on screen. The `numeric`
        class still has to be applied on top: Frank Ruhl Libre has tabular
        figures available but doesn't use them without tabular-nums asked for.
      */}
      <span
        ref={contentRef}
        className="numeric font-semibold leading-none whitespace-nowrap"
        style={{
          fontFamily: BOARD_FONTS.sefarim,
          fontSize: isFit ? undefined : boardFontSize(config.size, canvas.width),
        }}
      >
        {text}
      </span>
    </div>
  );
}
