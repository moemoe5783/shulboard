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
import type { ChabadZmanimByDate } from "@/lib/zmanim/resolve.ts";

const CANVAS = { width: 1920, height: 1080 };
/** The board element's real pixel size. Fixed so a measured edge is a
 *  number the test can compare against another measured edge. */
const BOARD_PX = { width: 1280, height: 720 };

export const ZMANIM_ID = "55555555-5555-4555-8555-555555555555";

/**
 * One day's rows, shaped like Chabad's and chosen for their hour widths:
 * 7, 10, 11, 1, 1, 5, 6, 7, 8, 7, 1. Right-aligning the whole string puts
 * five of those edges in one place and six in another, which is precisely
 * the report ("7:22 PM and 11:21 AM don't line up").
 *
 * `hour24` is only here to build an instant that sorts the way the display
 * reads, so the rendered order matches a real luach's.
 */
const ROWS: {
  id: string;
  label: string;
  translit: string;
  display: string;
  hour24: number;
  minute: number;
  nextDay?: boolean;
}[] = [
  { id: "netz", label: "Sunrise", translit: "Netz", display: "7:14 AM", hour24: 7, minute: 14 },
  {
    id: "sof_zman_shma_baal_hatanya",
    label: "Latest Shema",
    translit: "Sof Zman Shema",
    display: "10:18 AM",
    hour24: 10,
    minute: 18,
  },
  {
    id: "sof_zman_tfila_baal_hatanya",
    label: "Latest Shacharit",
    translit: "Sof Zman Tefila",
    display: "11:21 AM",
    hour24: 11,
    minute: 21,
  },
  { id: "chatzos", label: "Midday", translit: "Chatzos", display: "1:27 PM", hour24: 13, minute: 27 },
  {
    id: "mincha_gedola",
    label: "Earliest Mincha",
    translit: "Mincha Gedola",
    display: "1:59 PM",
    hour24: 13,
    minute: 59,
  },
  {
    id: "mincha_ketana",
    label: "Mincha Ketana",
    translit: "Mincha Ketana",
    display: "5:08 PM",
    hour24: 17,
    minute: 8,
  },
  {
    id: "plag_hamincha",
    label: "Plag HaMincha",
    translit: "Plag HaMincha",
    display: "6:26 PM",
    hour24: 18,
    minute: 26,
  },
  {
    id: "candle_lighting",
    label: "Candle Lighting",
    translit: "Hadlakas Neiros",
    display: "7:22 PM",
    hour24: 19,
    minute: 22,
  },
  { id: "shkia", label: "Sunset", translit: "Shkia", display: "7:41 PM", hour24: 19, minute: 41 },
  {
    id: "tzeis_baal_hatanya",
    label: "Nightfall",
    translit: "Tzeis HaKochavim",
    display: "8:05 PM",
    hour24: 20,
    minute: 5,
  },
  {
    id: "chatzos_laila",
    label: "Midnight",
    translit: "Chatzos HaLaila",
    display: "1:27 AM",
    hour24: 1,
    minute: 27,
    nextDay: true,
  },
];

/** Today, in the demo location's own zone — the date the widget resolves
 *  against. Built from `formatToParts` rather than a `format()` string, the
 *  same way lib/zmanim/warm.ts does it. */
function todayInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function buildCache(script: "english" | "transliteration"): ChabadZmanimByDate {
  const date = todayInZone(DEMO_LOCATION.timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const day1 = Object.fromEntries(
    ROWS.map((row) => {
      const at = Date.UTC(year, month - 1, day + (row.nextDay ? 1 : 0), row.hour24, row.minute);
      return [
        row.id,
        {
          iso: new Date(at).toISOString(),
          display: row.display,
          label: row.label,
          // Absent in the English case, so the label fallback is exercised
          // rather than assumed — a row with no provider transliteration
          // shows its English (plan.md §5c: no house table).
          ...(script === "transliteration" ? { translit: row.translit } : {}),
        },
      ];
    }),
  );
  return { [date]: day1 };
}

function buildDoc(options: { script: string; w: number; h: number; overflow: string }): BoardDoc {
  return parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { font: "assistant", ink: "ink", background: "surface" },
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
          size: 32,
          overflow: options.overflow,
        },
      },
    ],
  });
}

function ZmanimLabInner() {
  const params = useSearchParams();
  const script = params.get("script") === "transliteration" ? "transliteration" : "english";
  const overflow = params.get("overflow") === "scroll" ? "scroll" : "page";
  const w = Number(params.get("w") ?? 60);
  const h = Number(params.get("h") ?? 60);

  const zmanim: BoardZmanim = {
    provider: "chabad",
    hasChabadLocation: true,
    chabadZmanim: buildCache(script),
  };
  const doc = buildDoc({ script, w, h, overflow });

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
