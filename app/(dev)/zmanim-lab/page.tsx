"use client";

/*
 * The Zmanim table's LAYOUT, measurable.
 *
 * A dev reference page like /tokens, /primitives, /editor-lab and
 * /font-parity — permanent rather than a throwaway, because
 * scripts/test-zmanim-layout.mjs drives it on every `npm test` run.
 *
 * WHY THIS EXISTS AT ALL. The widget's layout rules are claims about
 * rendered pixels, and none of them can be checked by a pure function:
 *
 *  - the time column's outer edge is straight whatever the hour's width
 *    (widgets/zmanim/Renderer.tsx's four-track grid),
 *  - fit-to-box shrinks the type so the WHOLE table fits both axes — a
 *    narrower or shorter box renders smaller, never clipped or scrolled
 *    (widgets/zmanim/fit.ts).
 *
 * The table is always fit-to-box now — there is no sizing mode to switch and
 * no scroll/page overflow to choose; a busier day or a smaller box simply
 * renders smaller. scripts/test-zmanim-fit.ts covers the arithmetic with no
 * DOM; this page is the other half, the part only a browser can answer.
 *
 * THE CACHE IS SYNTHETIC, and deliberately so. A real 92-day fixture needs
 * the adapter, which is server-only, and it would pin the values to
 * whatever Chabad published for one location — whereas what this page needs
 * is control over the one property the alignment turns on: a mix of
 * one-digit and two-digit hours in the same table. The strings are shaped
 * exactly like the provider's ("7:22 PM"), and
 * scripts/test-zmanim-widget.ts is what checks the real ones.
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BoardRenderer } from "@/components/board/BoardRenderer";
import { parseBoardDoc, type BoardDoc } from "@/lib/board-doc";
import type { BoardZmanim } from "@/lib/board-zmanim";
import { DEMO_LOCATION } from "@/lib/demo-board";
import { buildCache, ROWS } from "./fixture";

const CANVAS = { width: 1920, height: 1080 };
/** The board element's real pixel size. Fixed so a measured edge is a
 *  number the test can compare against another measured edge. */
const BOARD_PX = { width: 1280, height: 720 };

export const ZMANIM_ID = "55555555-5555-4555-8555-555555555555";


function buildDoc(options: {
  script: string;
  w: number;
  h: number;
  overflow: string;
  padding: number;
  background: string;
  size: number;
  /** The board font — ?boardFont=<catalog id>. */
  font: string;
}): BoardDoc {
  return parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { font: options.font, ink: "ink", background: "surface" },
    widgets: [
      {
        id: ZMANIM_ID,
        type: "zmanim",
        x: 5,
        y: 5,
        w: options.w,
        h: options.h,
        z: 0,
        config: {
          zmanim: ROWS.map((row) => row.id),
          displayMode: "all",
          labelScript: options.script,
          size: options.size,
          overflow: options.overflow,
          padding: options.padding,
          background: options.background,
        },
      },
    ],
  });
}

function ZmanimLabInner() {
  const params = useSearchParams();
  const script = params.get("script") === "transliteration" ? "transliteration" : "english";
  const overflow = params.get("overflow") === "scroll" ? "scroll" : params.get("overflow") === "shrink" ? "shrink" : "page";
  const w = Number(params.get("w") ?? 60);
  const h = Number(params.get("h") ?? 60);
  // `pad` (frame padding as a multiple of the type size), `bg` (a background
  // hex, no `#`) and `size` (the stored `config.size`) let a test set up a
  // heavy frame on a small box — the case where padding could consume the whole
  // content area and freeze the fit (scripts/test-zmanim-layout.mjs, ITEM 3c).
  const padding = Number(params.get("pad") ?? 0);
  const background = params.get("bg") ? `#${params.get("bg")}` : "";
  const size = Number(params.get("size") ?? 32);

  const zmanim: BoardZmanim = {
    provider: "chabad",
    hasChabadLocation: true,
    chabadZmanim: buildCache(script),
  };
  const doc = buildDoc({ script, w, h, overflow, padding, background, size, font: params.get("boardFont") ?? "assistant" });

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-ink-soft text-[13px]" data-lab-state>
          {`${overflow} · ${script} · ${w}×${h}%`}
        </span>
      </div>
      <div data-zmanim-lab style={{ position: "relative", ...BOARD_PX }}>
        <BoardRenderer
          doc={doc}
          canvas={CANVAS}
          location={DEMO_LOCATION}
          zmanim={zmanim}
          style={BOARD_PX}
          widgetProps={(widget) => ({ "data-widget-id": widget.id })}
        />
      </div>
    </div>
  );
}

export default function ZmanimLabPage() {
  return (
    <Suspense fallback={null}>
      <ZmanimLabInner />
    </Suspense>
  );
}
