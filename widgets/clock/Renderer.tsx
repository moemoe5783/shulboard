"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useSecond } from "@/lib/tick";
import { boardFontSize, NUMERIC_FONT, NUMERIC_WEIGHT } from "@/lib/board-theme";
import { Digits } from "../Digits";
import type { WidgetRendererProps } from "../types";
import { onFontsChange, useFitFontSize } from "../useFitFontSize";
import { manifest, type ClockConfig } from "./manifest";

export function Renderer({ config, canvas }: WidgetRendererProps<ClockConfig>) {
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);

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
  const mode = config.sizingMode;
  const isFit = mode === "fit";
  const isHug = mode === "hug";

  /*
   * Every size decision measures the WIDEST time this format can show
   * (`widestTime`: all zeros, two-digit hour) in a hidden stand-in, not the
   * time on screen — so nothing resizes when 9:59 becomes 10:00, which is what
   * made `fit` a bad choice for a clock (docs/sizing.md §2). The stand-in only
   * changes when the format does (seconds on, 12/24h, a different zone).
   */
  const widest = second === null ? "" : widestTime(text);

  // `fit`: as large as the box allows on both axes. The text box is trimmed to
  // the figures (cap height to baseline, `text-box` below), so it's the digits
  // themselves that fill the height rather than the font's line box, which
  // left a short box with the time sitting in the middle of empty space.
  // `heightFraction` leaves room for round figures overshooting the cap
  // height; a browser without `text-box` measures the line box and simply
  // fills a little less.
  useFitFontSize(boxRef, measureRef, {
    minFontSize: manifest.sizing.minFontSize ?? 24,
    maxFontSize: manifest.sizing.maxFontSize ?? 1080,
    canvasWidth: canvas.width,
    enabled: isFit,
    heightFraction: 0.9,
    measureBy: "box",
    onFit: (px) => {
      if (contentRef.current) contentRef.current.style.fontSize = `${px}px`;
    },
    deps: [widest],
  });

  // `fixed` keeps the declared size — unless the box is too narrow for the
  // time at that size (seconds turned on, a box dragged in), where the clock
  // used to be cut off. Then the type shrinks exactly enough to fit
  // (docs/sizing.md §7). Not in `hug`, where the declared size drives the box.
  const isCapped = mode === "fixed";
  const scale = useWidthCap(boxRef, measureRef, { enabled: isCapped, deps: [widest, config.size, canvas.width] });

  const align =
    config.align === "center" ? "justify-center" : config.align === "right" ? "justify-end" : "justify-start";

  // Trimmed to the figures except in `hug`, whose box is the text's own
  // height — trimmed, a round figure's overshoot would be clipped by the frame.
  const trim = isHug ? "" : "[text-box:trim-both_cap_alphabetic]";
  const declared = boardFontSize(config.size, canvas.width);

  return (
    <div ref={boxRef} className={`relative flex h-full w-full items-center ${align}`}>
      {/*
        The board's or this widget's own face (lib/board-theme.ts's
        NUMERIC_FONT), in its lining figures. A clock showing seconds changes
        every second, and in a face without tabular figures it would jitter, so
        then <Digits> boxes each digit to the face's widest (widgets/Digits.tsx)
        — docs/sizing.md §4. Once a minute, a small width change is fine.
      */}
      <span
        ref={contentRef}
        className={`numeric leading-none whitespace-nowrap ${trim}`}
        style={{
          fontFamily: NUMERIC_FONT,
          fontWeight: NUMERIC_WEIGHT,
          fontSize: isFit ? undefined : isCapped && scale < 1 ? `calc(${declared} * ${scale})` : declared,
        }}
      >
        <Digits text={text} weight={600} boxed={config.showSeconds} />
      </span>
      {!isHug && (
        <span
          ref={measureRef}
          data-clock-measure
          aria-hidden
          className={`numeric pointer-events-none invisible absolute leading-none whitespace-nowrap ${trim}`}
          style={{ fontFamily: NUMERIC_FONT, fontWeight: NUMERIC_WEIGHT, fontSize: isFit ? undefined : declared }}
        >
          <Digits text={widest} weight={600} boxed={config.showSeconds} />
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
    if (!enabled || !box) return;
    let frame: number | null = null;
    const measure = () => {
      const probe = contentRef.current;
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
  return enabled ? scale : 1;
}
