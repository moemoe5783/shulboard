"use client";

import { useMemo, useRef } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { formatParsha } from "@/lib/hebrew/format";
import { currentParsha } from "@/lib/hebrew/parsha";
import { useSecond } from "@/lib/tick";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type ParshaConfig } from "./manifest";

const ENGLISH_LINE_SCALE = 0.55;

export function Renderer({ config, canvas }: WidgetRendererProps<ParshaConfig>) {
  const location = useBoardLocation();
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // The parsha only actually changes once a week, but re-deriving it off the
  // shared tick — rather than reading Date.now() once at mount — is what
  // makes the board correct if it's simply left open across the changeover,
  // the same reasoning docs/plan.md §3e already applies to every time widget.
  const text = useMemo(() => {
    if (second === null || !location) return null;
    const parsha = currentParsha(new Date(second * 1000), location);
    return formatParsha(parsha, { script: config.script, nekudos: config.nekudos });
  }, [second, location, config.script, config.nekudos]);

  const isFit = config.sizingMode === "fit";
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 12,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: isFit,
    deps: [text?.hebrew, text?.english],
  });

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — the parsha needs it." />;
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
        {/* No `whitespace-nowrap`, unlike Clock/Hebrew Date — a doubled
            parsha name is allowed to wrap, which is exactly what makes
            `hug` mode a genuine option here (manifest.ts). */}
        {text?.hebrew && (
          <span
            dir="rtl"
            lang="he"
            className="font-semibold leading-tight"
            style={{ fontFamily: BOARD_FONTS.sefarim, fontSize: "1em" }}
          >
            {text.hebrew}
          </span>
        )}
        {text?.english && (
          <span className="leading-tight opacity-80" style={{ fontSize: `${ENGLISH_LINE_SCALE}em` }}>
            {text.english}
          </span>
        )}
      </div>
    </div>
  );
}
