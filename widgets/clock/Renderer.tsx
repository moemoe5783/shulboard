"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useSecond } from "@/lib/tick";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import type { WidgetRendererProps } from "../types";
import { onFontsChange, useFitFontSize } from "../useFitFontSize";
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

  // `fixed` keeps the declared size — unless the box is too narrow for
  // the time at that size (seconds turned on, a 24h→12h switch, a box dragged
  // in), where the clock used to be cut off. Then the type shrinks exactly
  // enough to fit the widest time this format can show, so it never clips and
  // never changes size when the hour gains a digit (docs/sizing.md §7).
  const widest = second === null ? "" : widestTime(text);
  // Not in `hug`, whose contract is that the declared size drives the box.
  const isCapped = config.sizingMode === "fixed";
  const scale = useWidthCap(boxRef, contentRef, { enabled: isCapped, deps: [widest, config.size, canvas.width] });

  const align =
    config.align === "center" ? "justify-center" : config.align === "right" ? "justify-end" : "justify-start";

  return (
    <div ref={boxRef} className={`relative flex h-full w-full items-center ${align}`}>
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
          fontSize: isFit
            ? undefined
            : isCapped && scale < 1
              ? `calc(${boardFontSize(config.size, canvas.width)} * ${scale})`
              : boardFontSize(config.size, canvas.width),
        }}
      >
        {text}
      </span>
      {/* The widest time this format shows, measured at the declared size. */}
      {isCapped && (
        <span
          data-clock-measure
          aria-hidden
          className="numeric pointer-events-none invisible absolute font-semibold leading-none whitespace-nowrap"
          style={{ fontFamily: BOARD_FONTS.sefarim, fontSize: boardFontSize(config.size, canvas.width) }}
        >
          {widest}
        </span>
      )}
    </div>
  );
}

/** The widest string the clock's current format produces: every digit becomes
 *  "0" (tabular figures make them all one width) and the hour takes two digits,
 *  so "7:05:09 PM" measures as "00:00:00 PM". */
export function widestTime(text: string): string {
  return text.replace(/\d+/, (hour) => hour.padStart(2, "0")).replace(/\d/g, "0");
}

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** How much to scale the declared size down (≤ 1) so the widest time fits the
 *  box's width. 1 when it fits, or when disabled. */
function useWidthCap(
  boxRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLSpanElement | null>,
  { enabled, deps }: { enabled: boolean; deps: unknown[] },
): number {
  const [scale, setScale] = useState(1);
  useIsomorphicLayoutEffect(() => {
    const box = boxRef.current;
    if (!enabled || !box) {
      setScale(1);
      return;
    }
    let frame: number | null = null;
    const measure = () => {
      const probe = box.querySelector<HTMLElement>("[data-clock-measure]");
      const available = box.clientWidth;
      const needed = probe?.getBoundingClientRect().width ?? 0;
      if (available <= 0 || needed <= 0) return;
      // A hair under the exact ratio so rounding never lands a pixel over.
      const next = needed > available ? (available / needed) * 0.995 : 1;
      setScale((previous) => (Math.abs(previous - next) < 0.002 ? previous : next));
    };
    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    const stopFonts = onFontsChange(schedule);
    return () => {
      observer.disconnect();
      stopFonts();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, boxRef, contentRef, ...deps]);
  return scale;
}
