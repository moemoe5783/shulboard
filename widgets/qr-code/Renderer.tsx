"use client";

import { useMemo } from "react";
import { encode } from "uqr";
import { boardLength } from "@/lib/board-theme";
import { PhotoEmpty } from "../media/PhotoEmpty";
import { readConfig } from "../read-config";
import type { WidgetRendererProps } from "../types";
import { qrCodeConfigSchema, type QrCodeConfig } from "./manifest";

/** The dark squares as one SVG path — one element however dense the code. */
function modulePath(data: boolean[][], margin: number): string {
  let d = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      // Runs of dark squares in a row become one rectangle.
      let run = 1;
      while (x + run < row.length && row[x + run]) run += 1;
      d += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return d;
}

export function Renderer({ config: raw, canvas }: WidgetRendererProps<QrCodeConfig>) {
  const config = readConfig(qrCodeConfigSchema, raw);
  const code = useMemo(() => {
    const value = config.value.trim();
    if (!value) return null;
    try {
      return encode(value, { ecc: config.errorCorrection, border: 0 });
    } catch {
      return "too-long" as const;
    }
  }, [config.value, config.errorCorrection]);

  // Editor-only instructions: on a screen, an unfinished QR code shows nothing.
  if (code === null) return <PhotoEmpty canvas={canvas} message="Add a link for this QR code." editorOnly />;
  if (code === "too-long") {
    return <PhotoEmpty canvas={canvas} message="This link is too long for a QR code. Use a shorter one." editorOnly />;
  }

  const margin = config.margin;
  const extent = code.size + margin * 2;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center" data-qr-code>
      {/* The code takes the largest square the space above the caption allows.
          A size container for this wrapper alone (`cqmin` is its smaller side);
          nothing inside it reads the board's `cqw`, so nesting one here doesn't
          change any board length. */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center" style={{ containerType: "size" }}>
        <svg
          role="img"
          aria-label={config.caption || `QR code for ${config.value}`}
          viewBox={`0 0 ${extent} ${extent}`}
          shapeRendering="crispEdges"
          className="block"
          style={{ width: "100cqmin", height: "100cqmin" }}
        >
          <rect width={extent} height={extent} fill={config.lightColor} />
          <path d={modulePath(code.data, margin)} fill={config.darkColor} />
        </svg>
      </div>
      {config.caption && (
        <span
          dir="auto"
          className="shrink-0 text-center leading-tight"
          style={{ fontSize: boardLength(config.captionSize, canvas.width), marginTop: `${config.captionGap}em` }}
        >
          {config.caption}
        </span>
      )}
    </div>
  );
}
