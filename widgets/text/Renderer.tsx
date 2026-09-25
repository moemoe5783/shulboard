"use client";

import { useRef } from "react";
import { boardFontSize } from "@/lib/board-theme";
import { readConfig } from "../read-config";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, textConfigSchema, type TextConfig } from "./manifest";

export function Renderer({ config: raw, canvas }: WidgetRendererProps<TextConfig>) {
  const config = readConfig(textConfigSchema, raw);
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isFit = config.sizingMode === "fit";

  // `fit` only: the largest size at which the wrapped text still fits the box.
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 8,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: isFit,
    deps: [config.text, config.lineHeight, config.bold, config.align],
  });

  const justify = config.verticalAlign === "middle" ? "justify-center" : config.verticalAlign === "bottom" ? "justify-end" : "justify-start";

  return (
    <div ref={boxRef} className={`flex h-full w-full flex-col ${justify}`}>
      <div
        ref={contentRef}
        // One block per line so each takes its own direction: a Hebrew line
        // reads right to left beside an English one (dir="auto").
        style={{
          fontSize: isFit ? undefined : boardFontSize(config.size, canvas.width),
          lineHeight: config.lineHeight,
          // The element's chosen weight, else regular or its face's own bold,
          // each within what the face offers (widgets/style.ts).
          fontWeight: config.bold
            ? "var(--board-weight-main, var(--board-weight-bold, 700))"
            : "var(--board-weight-main, var(--board-weight-regular, 400))",
          textAlign: config.align,
          overflowWrap: "anywhere",
        }}
      >
        {config.text.split("\n").map((line, i) => (
          <p key={i} dir="auto" className="m-0 whitespace-pre-wrap" style={{ minHeight: `${config.lineHeight}em` }}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
