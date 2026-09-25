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
  const isHug = config.sizingMode === "hug";

  // `fit`: the largest size at which the wrapped text still fits the box.
  // `fixed`: the typed size, unless the box is too small for it — then as
  // large as fits, the way a fixed clock shrinks rather than being cut off.
  // `hug`: the typed size; the box grows to it instead.
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 8,
    maxFontSize: isFit ? (manifest.sizing.maxFontSize ?? 400) : config.size,
    canvasWidth: canvas.width,
    enabled: !isHug,
    deps: [config.text, config.lineHeight, config.bold, config.align, config.size, config.sizingMode],
  });

  const justify = config.verticalAlign === "middle" ? "justify-center" : config.verticalAlign === "bottom" ? "justify-end" : "justify-start";

  return (
    <div ref={boxRef} className={`flex h-full w-full flex-col ${justify}`}>
      <div
        ref={contentRef}
        // One block per line so each takes its own direction: a Hebrew line
        // reads right to left beside an English one (dir="auto").
        style={{
          fontSize: isHug ? boardFontSize(config.size, canvas.width) : undefined,
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
          // Each line takes its own direction (dir="auto", plaintext bidi), so
          // under "start" a Hebrew line aligns right and an English one left,
          // whatever the first line was.
          <p key={i} dir="auto" className="m-0 whitespace-pre-wrap" style={{ minHeight: `${config.lineHeight}em`, unicodeBidi: "plaintext" }}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
