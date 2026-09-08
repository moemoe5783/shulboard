"use client";

import { useMemo, useRef } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { upcomingCandleLighting } from "@/lib/hebrew/candle-times";
import { formatCountdown, formatEventLabel, formatTimeOfDay } from "@/lib/hebrew/format";
import { useSecond } from "@/lib/tick";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type CandleLightingConfig } from "./manifest";

const LABEL_SCALE = 0.4;
const COUNTDOWN_SCALE = 0.45;

export function Renderer({ config, canvas }: WidgetRendererProps<CandleLightingConfig>) {
  const location = useBoardLocation();
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const now = second === null ? null : new Date(second * 1000);

  // Re-searched every tick: the countdown has to move every minute, and once
  // a candle-lighting time passes, the very next tick has to find the
  // FOLLOWING one (test:hebrew's "advances past an event once it's passed").
  // Keyed on `second`, not `now` — a fresh Date every render would defeat
  // the memo even when the second hasn't actually changed.
  const event = useMemo(
    () => (second !== null && location ? upcomingCandleLighting(new Date(second * 1000), location) : null),
    [second, location],
  );

  const isFit = config.sizingMode === "fit";
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 14,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: isFit,
    // The countdown ticks every minute without the box needing to resize —
    // only the event identity (a new Friday) is worth re-fitting for.
    deps: [event?.eventTime.getTime()],
  });

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — candle lighting needs it." />;
  }
  if (!now || !event) return null;

  const label = formatEventLabel(event, { script: config.script, nekudos: config.nekudos });
  const time = formatTimeOfDay(event.eventTime, { hour12: config.hour12, timeZone: location.timeZone });
  const countdown = formatCountdown(event.eventTime.getTime() - now.getTime());

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
        className="flex flex-col gap-[0.1em]"
        style={{ fontSize: isFit ? undefined : boardFontSize(config.size, canvas.width) }}
      >
        {label.hebrew && (
          <span
            dir="rtl"
            lang="he"
            className="font-semibold leading-tight opacity-80"
            style={{ fontFamily: BOARD_FONTS.sefarim, fontSize: `${LABEL_SCALE}em` }}
          >
            {label.hebrew}
          </span>
        )}
        {label.english && (
          <span className="leading-tight opacity-80" style={{ fontSize: `${LABEL_SCALE}em` }}>
            {label.english}
          </span>
        )}

        {/* The time itself — Frank Ruhl Libre, tabular, same as Clock. */}
        <span
          className="numeric font-semibold leading-none whitespace-nowrap"
          style={{ fontFamily: BOARD_FONTS.sefarim, fontSize: "1em" }}
        >
          {time}
        </span>

        {config.showCountdown && (
          <span
            className="numeric leading-tight whitespace-nowrap opacity-80"
            style={{ fontFamily: BOARD_FONTS.sefarim, fontSize: `${COUNTDOWN_SCALE}em` }}
          >
            {countdown}
          </span>
        )}
      </div>
    </div>
  );
}
