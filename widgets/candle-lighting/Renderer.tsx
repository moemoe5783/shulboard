"use client";

import { useMemo, useRef } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { useBoardZmanim } from "@/lib/board-zmanim";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { upcomingCandleLighting } from "@/lib/hebrew/candle-times";
import { formatCandleLightingLabel, formatCountdown, formatEventLabel, formatTimeOfDay } from "@/lib/hebrew/format";
import { useSecond } from "@/lib/tick";
import { nextChabadCandleLighting } from "@/lib/zmanim/resolve";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type CandleLightingConfig } from "./manifest";

const LABEL_SCALE = 0.4;
const COUNTDOWN_SCALE = 0.45;

export function Renderer({ config, canvas }: WidgetRendererProps<CandleLightingConfig>) {
  const location = useBoardLocation();
  const zmanim = useBoardZmanim();
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const now = second === null ? null : new Date(second * 1000);

  // "inherit" (the default) defers to the board's own resolved provider —
  // dataNeeds (manifest.ts) can't do this resolution itself, since it only
  // ever sees this widget's own config, never the screen/org context
  // "inherit" defers to; this is the one place both are in hand.
  const effectiveProvider = config.provider === "inherit" ? zmanim.provider : config.provider;
  const isChabad = effectiveProvider === "chabad";
  const chabadUnconfigured = isChabad && !zmanim.hasChabadLocation;

  // Re-searched every tick: the countdown has to move every minute, and once
  // a candle-lighting time passes, the very next tick has to find the
  // FOLLOWING one (test:hebrew's "advances past an event once it's passed").
  // Keyed on `second`, not `now` — a fresh Date every render would defeat
  // the memo even when the second hasn't actually changed.
  const hebcalEvent = useMemo(
    () =>
      second !== null && location && !isChabad
        ? upcomingCandleLighting(
            new Date(second * 1000),
            location,
            effectiveProvider === "manual" ? config.manualMinutesBeforeSunset : undefined,
          )
        : null,
    [second, location, isChabad, effectiveProvider, config.manualMinutesBeforeSunset],
  );

  // Same "next one, after now" contract as hebcalEvent above, read from the
  // cached dict (lib/board-zmanim.tsx) instead of computed — see
  // lib/zmanim/resolve.ts.
  const chabadEvent = useMemo(
    () =>
      second !== null && isChabad && zmanim.chabadZmanim
        ? nextChabadCandleLighting(new Date(second * 1000), zmanim.chabadZmanim)
        : null,
    [second, isChabad, zmanim.chabadZmanim],
  );

  const resolved = isChabad
    ? chabadEvent && {
        time: new Date(chabadEvent.iso),
        label: formatCandleLightingLabel({ script: config.script, nekudos: config.nekudos }),
      }
    : hebcalEvent && {
        time: hebcalEvent.eventTime,
        label: formatEventLabel(hebcalEvent, { script: config.script, nekudos: config.nekudos }),
      };

  const isFit = config.sizingMode === "fit";
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 14,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: isFit,
    // The countdown ticks every minute without the box needing to resize —
    // only the event identity (a new Friday) is worth re-fitting for.
    deps: [resolved ? resolved.time.getTime() : null],
  });

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — candle lighting needs it." />;
  }
  // A distinct gap from the one above: lat/long can be set while the
  // separate ZIP/Chabad-location fields this provider also needs are not —
  // see the proposal this was built from for why these don't collapse into
  // one message. Checked before `!resolved` below: an unconfigured Chabad
  // widget should never read as "no time yet," which is what an ordinary,
  // temporary cache-not-warmed-yet gap looks like.
  if (chabadUnconfigured) {
    return (
      <EmptyLocation
        canvas={canvas}
        message="This shul hasn't set a ZIP or Chabad.org location yet — candle lighting needs it."
      />
    );
  }
  if (!now || !resolved) return null;

  const { label, time: eventTime } = resolved;
  const time = formatTimeOfDay(eventTime, { hour12: config.hour12, timeZone: location.timeZone });
  const countdown = formatCountdown(eventTime.getTime() - now.getTime());

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
