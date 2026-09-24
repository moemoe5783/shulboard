"use client";

/*
 * One Clock on a board, configured from the query string — what
 * scripts/test-clock-fit.mjs drives to check that `fit` mode follows its box:
 * the type grows until the time touches the box's width or height, never past
 * either edge, and doesn't change size when the digits do.
 *
 *   ?mode=fit&w=40&h=20&align=center&seconds=1&h12=1&font=heebo&boardFont=rubik&tz=Etc/GMT+3
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BoardRenderer } from "@/components/board/BoardRenderer";
import { parseBoardDoc } from "@/lib/board-doc";

const CANVAS = { width: 1920, height: 1080 };
const BOARD_PX = { width: 1280, height: 720 };
const CLOCK_ID = "44444444-4444-4444-8444-444444444444";

function ClockLabInner() {
  const params = useSearchParams();
  const doc = parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { font: params.get("boardFont") ?? "assistant", ink: "ink", background: "surface" },
    widgets: [
      {
        id: CLOCK_ID,
        type: "clock",
        x: 2,
        y: 2,
        w: Number(params.get("w") ?? 40),
        h: Number(params.get("h") ?? 20),
        z: 0,
        config: {
          sizingMode: params.get("mode") ?? "fit",
          align: params.get("align") ?? "left",
          showSeconds: params.get("seconds") === "1",
          hour12: params.get("h12") !== "0",
          size: Number(params.get("size") ?? 140),
          ...(params.get("font") ? { font: params.get("font") } : {}),
          ...(params.get("tz") ? { timeZone: params.get("tz") } : {}),
        },
      },
    ],
  });
  return (
    <div className="p-4">
      <div data-clock-lab style={{ position: "relative", ...BOARD_PX }}>
        <BoardRenderer
          doc={doc}
          canvas={CANVAS}
          style={BOARD_PX}
          widgetProps={(widget) => ({ "data-widget-id": widget.id })}
        />
      </div>
    </div>
  );
}

export default function ClockLabPage() {
  return (
    <Suspense fallback={null}>
      <ClockLabInner />
    </Suspense>
  );
}
