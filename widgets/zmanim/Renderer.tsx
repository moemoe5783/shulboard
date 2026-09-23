"use client";

import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useBoardLocation } from "@/lib/board-location";
import { useBoardZmanim } from "@/lib/board-zmanim";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import { resolveZmanimTable, type ResolvedZman } from "@/lib/zmanim/resolve-zmanim";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { resolveDesignPx, resolveDesignUnits } from "../useFitFontSize";
import { splitTimeColumns } from "./display-time";
import { pageCount, rowsPerPage, zmanimFontPx } from "./fit";
import { manifest, type ZmanimConfig } from "./manifest";

/** The footnote block, relative to a row's own type size. Small — a sentence of
 *  prose under a table of figures, never competing with the times. */
const FOOTNOTE_SCALE = 0.5;

/** The "Zmanim from Chabad.org" credit line, relative to a row's type size. */
const ATTRIBUTION_SCALE = 0.32;

/** Seconds each page holds before the table cycles — only in `page` overflow. */
const PAGE_SECONDS = 8;

/** Seconds of scroll per row, in `scroll` overflow — a legible departures-board
 *  pace rather than a blur. */
const SCROLL_SECONDS_PER_ROW = 2.4;

const LABEL_GAP = "1em";
const GRID_COLUMNS = "1fr max-content max-content max-content";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function Renderer({ config, canvas }: WidgetRendererProps<ZmanimConfig>) {
  const location = useBoardLocation();
  const zmanim = useBoardZmanim();
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  /** The row grid — the first (and, in scroll, load-bearing) copy. Width and
   *  per-row height are measured off it. */
  const gridRef = useRef<HTMLDivElement>(null);
  /** Footnotes + the attribution line, whose height is reserved out of the rows
   *  region so paging and scrolling account for it. */
  const chromeRef = useRef<HTMLDivElement>(null);

  const chabadUnconfigured = !zmanim.hasChabadLocation;

  const resolved = useMemo(
    () =>
      second !== null && location
        ? resolveZmanimTable({
            now: new Date(second * 1000),
            ids: config.zmanim,
            location,
            chabadZmanim: zmanim.chabadZmanim,
          })
        : null,
    [second, location, zmanim.chabadZmanim, config.zmanim],
  );

  const rows: ResolvedZman[] =
    config.displayMode === "next"
      ? resolved?.next
        ? [resolved.next]
        : []
      : resolved?.today.status === "ok"
        ? resolved.today.rows
        : [];

  const isTranslit = config.labelScript === "transliteration";
  const labelOf = (row: ResolvedZman) => (isTranslit ? row.translit ?? row.label : row.label);

  const footnotes = config.showFootnotes ? distinctFootnotes(rows) : [];

  const layout = useZmanimLayout({
    boxRef,
    gridRef,
    chromeRef,
    canvasWidth: canvas.width,
    rowCount: rows.length,
    signature: `${rows.map(labelOf).join("|")}::${footnotes.join("|")}`,
  });

  // The widget's appearance is applied by BoardRenderer.WidgetFrame around this
  // Renderer (widgets/style.ts); this returns only the table.

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — zmanim need it." />;
  }
  if (chabadUnconfigured) {
    return (
      <EmptyLocation
        canvas={canvas}
        message="This shul hasn't set a ZIP or Chabad.org location yet — zmanim need it."
      />
    );
  }
  if (config.zmanim.length === 0) {
    return <EmptyLocation canvas={canvas} message="No zmanim chosen yet — pick which times to show." />;
  }
  if (rows.length === 0) {
    return (
      <div className="flex h-full w-full flex-col justify-center">
        <span className="leading-tight opacity-60" style={{ fontSize: boardFontSize(config.size, canvas.width) }}>
          No zmanim for this date
        </span>
      </div>
    );
  }

  const { rowHeightPx, availableHeightPx, contentHeightPx } = layout;

  return (
    <div ref={boxRef} className="relative flex h-full w-full flex-col overflow-hidden">
      {config.overflow === "scroll" ? (
        <ScrollRegion
          availableHeightPx={availableHeightPx}
          contentHeightPx={contentHeightPx}
          rowCount={rows.length}
          gridRef={gridRef}
          rows={rows}
          labelOf={labelOf}
        />
      ) : (
        <PageRegion
          availableHeightPx={availableHeightPx}
          rowHeightPx={rowHeightPx}
          rowCount={rows.length}
          second={second}
          gridRef={gridRef}
          rows={rows}
          labelOf={labelOf}
        />
      )}

      {/* Footnotes (opt-in) and the source credit — held out of the rows region
          and sitting just under it (no auto-margin gap). */}
      <div ref={chromeRef} className="flex shrink-0 flex-col">
        {footnotes.length > 0 && (
          <div
            className="flex flex-col opacity-60"
            style={{ fontSize: `${FOOTNOTE_SCALE}em`, marginTop: "0.5em", gap: "0.2em" }}
          >
            {footnotes.map((text) => (
              <span key={text} className="leading-tight">
                {text}
              </span>
            ))}
          </div>
        )}
        <span
          data-zmanim-attribution
          className="leading-tight opacity-50"
          style={{ fontSize: `${ATTRIBUTION_SCALE}em`, marginTop: "0.3em" }}
        >
          Zmanim from Chabad.org
        </span>
      </div>
    </div>
  );
}

/** The rows in `page` overflow: a whole-rows viewport that cycles pages. */
function PageRegion({
  availableHeightPx,
  rowHeightPx,
  rowCount,
  second,
  gridRef,
  rows,
  labelOf,
}: {
  availableHeightPx: number;
  rowHeightPx: number;
  rowCount: number;
  second: number | null;
  gridRef: RefObject<HTMLDivElement | null>;
  rows: ResolvedZman[];
  labelOf: (row: ResolvedZman) => string;
}) {
  const perPage = rowsPerPage(availableHeightPx || 1, rowHeightPx || 1);
  const pages = pageCount(rowCount, perPage);
  const page = second === null ? 0 : Math.floor(second / PAGE_SECONDS) % pages;
  const pageHeightPx = availableHeightPx > 0 ? Math.min(perPage, rowCount) * rowHeightPx : undefined;

  return (
    <div data-zmanim-viewport className="w-full overflow-hidden" style={{ height: pageHeightPx }}>
      <div style={{ transform: `translateY(${-page * (pageHeightPx ?? 0)}px)`, transition: "transform 400ms ease" }}>
        <ZmanimGrid ref={gridRef} rows={rows} labelOf={labelOf} keyPrefix="" />
      </div>
    </div>
  );
}

/** The rows in `scroll` overflow: a continuous vertical scroll. Two identical
 *  copies with a -50% keyframe (app/globals.css) make the loop seamless — the
 *  last frame is pixel-identical to the first — and the copy only mounts when the
 *  content actually overflows, so a table that fits sits still. */
function ScrollRegion({
  availableHeightPx,
  contentHeightPx,
  rowCount,
  gridRef,
  rows,
  labelOf,
}: {
  availableHeightPx: number;
  contentHeightPx: number;
  rowCount: number;
  gridRef: RefObject<HTMLDivElement | null>;
  rows: ResolvedZman[];
  labelOf: (row: ResolvedZman) => string;
}) {
  const needsScroll = availableHeightPx > 0 && contentHeightPx > availableHeightPx + 1;
  const durationSeconds = Math.max(8, rowCount * SCROLL_SECONDS_PER_ROW);

  return (
    <div data-zmanim-viewport className="w-full overflow-hidden" style={{ height: availableHeightPx || undefined }}>
      <div
        style={needsScroll ? { animation: `zmanim-scroll ${durationSeconds}s linear infinite` } : undefined}
      >
        <ZmanimGrid ref={gridRef} rows={rows} labelOf={labelOf} keyPrefix="" />
        {needsScroll && <ZmanimGrid rows={rows} labelOf={labelOf} keyPrefix="dup-" aria-hidden />}
      </div>
    </div>
  );
}

const ZmanimGrid = forwardRef<
  HTMLDivElement,
  { rows: ResolvedZman[]; labelOf: (row: ResolvedZman) => string; keyPrefix: string; "aria-hidden"?: boolean }
>(function ZmanimGrid({ rows, labelOf, keyPrefix, "aria-hidden": ariaHidden }, ref) {
  return (
    <div
      ref={ref}
      aria-hidden={ariaHidden}
      className="grid w-full"
      style={{ gridTemplateColumns: GRID_COLUMNS, columnGap: 0 }}
    >
      {rows.map((row) => (
        <Row key={`${keyPrefix}${row.id}`} row={row} label={labelOf(row)} />
      ))}
    </div>
  );
});

type ZmanimLayout = { fontPx: number; rowHeightPx: number; availableHeightPx: number; contentHeightPx: number };

/**
 * Measures the box and computes the width-driven type size and the row/height
 * numbers both overflow modes need — ./fit.ts has the size rule; this is the DOM
 * measurement. The font size is written straight to the box (imperative, so a
 * resize drag re-measures every frame), and also to `data-fitted-size` in design
 * units, which the properties panel's type field reads live and resizes the box
 * against (components/editor/useElementFontSize.ts).
 */
function useZmanimLayout(options: {
  boxRef: RefObject<HTMLElement | null>;
  gridRef: RefObject<HTMLElement | null>;
  chromeRef: RefObject<HTMLElement | null>;
  canvasWidth: number;
  rowCount: number;
  signature: string;
}): ZmanimLayout {
  const { boxRef, gridRef, chromeRef, canvasWidth, rowCount, signature } = options;
  const [layout, setLayout] = useState<ZmanimLayout>({
    fontPx: 0,
    rowHeightPx: 0,
    availableHeightPx: 0,
    contentHeightPx: 0,
  });
  const pendingFrame = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const box = boxRef.current;
    const grid = gridRef.current;
    if (!box || !grid || rowCount === 0) return;

    const measure = () => {
      const boxWidthPx = box.clientWidth;
      const boxHeightPx = box.clientHeight;
      if (boxWidthPx === 0 || boxHeightPx === 0) return;

      const ref = resolveDesignPx(100, canvasWidth, box);
      if (ref <= 0) return;
      box.style.fontSize = `${ref}px`;

      const previousWidth = grid.style.width;
      grid.style.width = "max-content";
      const widthPerFontPx = grid.getBoundingClientRect().width / ref;
      grid.style.width = previousWidth;

      const rowHeightPerFontPx = grid.getBoundingClientRect().height / rowCount / ref;
      const chromePerFontPx = chromeRef.current ? chromeRef.current.getBoundingClientRect().height / ref : 0;

      const fontPx = zmanimFontPx(
        { boxWidthPx, widthPerFontPx },
        {
          minPx: resolveDesignPx(manifest.sizing.minFontSize ?? 6, canvasWidth, box),
          maxPx: resolveDesignPx(manifest.sizing.maxFontSize ?? 400, canvasWidth, box),
        },
      );
      box.style.fontSize = `${fontPx}px`;

      const rowHeightPx = rowHeightPerFontPx * fontPx;
      const availableHeightPx = Math.max(0, boxHeightPx - chromePerFontPx * fontPx);
      const contentHeightPx = rowHeightPx * rowCount;

      box.dataset.fittedSize = String(Math.round(resolveDesignUnits(fontPx, canvasWidth, box)));

      setLayout((previous) =>
        Math.abs(previous.fontPx - fontPx) < 0.5 &&
        Math.abs(previous.rowHeightPx - rowHeightPx) < 0.5 &&
        Math.abs(previous.availableHeightPx - availableHeightPx) < 0.5 &&
        Math.abs(previous.contentHeightPx - contentHeightPx) < 0.5
          ? previous
          : { fontPx, rowHeightPx, availableHeightPx, contentHeightPx },
      );
    };

    measure();

    const observer = new ResizeObserver(() => {
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = requestAnimationFrame(measure);
    });
    observer.observe(box);

    return () => {
      observer.disconnect();
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    };
  }, [boxRef, gridRef, chromeRef, canvasWidth, rowCount, signature]);

  return layout;
}

/**
 * One row: the provider's own label and time string, verbatim (§5c). Four grid
 * cells so every row's label, hour, minutes and meridiem share one column — the
 * hour right-aligns in its own `max-content` track, so a "7" and an "11" put
 * their colons at the same x and the outer edge is straight. Nothing wraps.
 */
function Row({ row, label }: { row: ResolvedZman; label: string }) {
  const parts = splitTimeColumns(row.display);

  const gap: CSSProperties = { paddingLeft: LABEL_GAP };
  const time: CSSProperties = { fontFamily: BOARD_FONTS.sefarim };
  const timeClass = "numeric font-semibold leading-snug whitespace-nowrap";

  const labelCell = (
    <span key="label" className="min-w-0 overflow-hidden leading-snug whitespace-nowrap opacity-80">
      {label}
    </span>
  );

  if (!parts) {
    return (
      <>
        {labelCell}
        <span className={timeClass} style={{ ...time, ...gap, gridColumn: "span 3", justifySelf: "end" }}>
          {row.display}
        </span>
      </>
    );
  }

  return (
    <>
      {labelCell}
      <span key="hours" className={timeClass} style={{ ...time, justifySelf: "end", ...gap }}>
        {parts.hours}
      </span>
      <span key="minutes" className={timeClass} style={time}>
        {parts.minutes}
      </span>
      <span key="meridiem" className={timeClass} style={{ ...time, whiteSpace: "pre", justifySelf: "end" }}>
        {parts.meridiem}
      </span>
    </>
  );
}

/** The provider's footnote texts, deduped in row order. */
function distinctFootnotes(rows: readonly ResolvedZman[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.footnote) seen.add(row.footnote);
  }
  return [...seen];
}
