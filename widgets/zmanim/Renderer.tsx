"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { useBoardZmanim } from "@/lib/board-zmanim";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import { resolveZmanimTable, type ResolvedZman } from "@/lib/zmanim/resolve-zmanim";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { resolveDesignPx } from "../useFitFontSize";
import { splitTimeColumns } from "./display-time";
import { pageCount, rowsPerPage, zmanimFontPx } from "./fit";
import { manifest, type ZmanimConfig } from "./manifest";

/** The footnote block, relative to a row's own type size. Small — it is a
 *  sentence of prose sitting under a table of figures, and it must never
 *  compete with the times. */
const FOOTNOTE_SCALE = 0.5;

/** The "Zmanim from Chabad.org" credit line, relative to a row's type size.
 *  Deliberately small — it names the source without competing with the times. */
const ATTRIBUTION_SCALE = 0.32;

/** Seconds each page holds before the table cycles to the next — only when the
 *  rows don't all fit at once. Eight, the same legibility number the candle
 *  widget rotates on: long enough to read a page, slow enough not to flicker. */
const PAGE_SECONDS = 8;

/**
 * The gap between the label column and the time column.
 *
 * NOT `column-gap`: the times are three tracks (hours, ":MM", meridiem — see
 * `Row`) that must sit flush against each other, which one grid `column-gap`
 * cannot express. So the gap is padding on the time cell adjacent to the label,
 * and the grid's own gap is zero. In `em`, so it scales with the type.
 */
const LABEL_GAP = "1em";

/**
 * The row grid's tracks: the label takes the slack, each piece of the time
 * takes exactly what it needs. The label is track one; the times follow left
 * to right. Both label forms are Latin and LTR, so nothing reorders these.
 */
const GRID_COLUMNS = "1fr max-content max-content max-content";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function Renderer({ config, canvas }: WidgetRendererProps<ZmanimConfig>) {
  const location = useBoardLocation();
  const zmanim = useBoardZmanim();
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  /** The clip region that shows one page of whole rows. */
  const viewportRef = useRef<HTMLDivElement>(null);
  /** The row grid — always holds ALL rows, so its width and per-row height are
   *  measurable and paging is a translate rather than a second copy. */
  const gridRef = useRef<HTMLDivElement>(null);
  /** Footnotes + the attribution line, so their height can be reserved out of
   *  the space the rows page through. */
  const chromeRef = useRef<HTMLDivElement>(null);

  // Chabad.org is the only source (lib/zmanim/provider.ts), so there is no
  // provider to resolve. What still matters is whether Chabad has a location
  // to look the shul up by.
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

  // English name, or the Hebrew name spelled in Latin letters — both the
  // provider's own words (lib/zmanim/chabad-rss.ts). A row the feed gave no
  // transliteration for falls back to its English. Both render LTR, so nothing
  // about the table mirrors.
  const isTranslit = config.labelScript === "transliteration";
  const labelOf = (row: ResolvedZman) => (isTranslit ? row.translit ?? row.label : row.label);

  const footnotes = config.showFootnotes ? distinctFootnotes(rows) : [];

  /*
   * WIDTH-CAPPED TYPE, VERTICAL PAGING — ./fit.ts. The type renders at the
   * configured size, shrunk only if the widest row would overflow the width;
   * the box's height never rescales it. When the rows don't all fit the height,
   * the table pages through whole rows instead of shrinking. The signature
   * re-measures whenever the rows, the footnotes or the type size change.
   */
  const layout = useZmanimLayout({
    boxRef,
    gridRef,
    chromeRef,
    canvasWidth: canvas.width,
    configSize: config.size,
    rowCount: rows.length,
    signature: `${config.size}::${rows.map(labelOf).join("|")}::${footnotes.join("|")}`,
  });

  const pages = pageCount(rows.length, layout.rowsPerPage);
  const page = second === null ? 0 : Math.floor(second / PAGE_SECONDS) % pages;

  // The widget's appearance — background, padding, radius, border, colour, font
  // and an optional header — is applied by BoardRenderer.WidgetFrame around this
  // Renderer (widgets/style.ts), for every widget in one place.

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — zmanim need it." />;
  }
  // A distinct gap from the one above: lat/long can be set while the ZIP Chabad
  // needs is not, and an unconfigured widget must never read as "no times for
  // this date," a different and temporary condition.
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

  /*
   * Chabad has nothing for any of the selected zmanim on this date — a COMMON
   * state, deliberately not an offline message: the display boots from its
   * last-known-good bundle and keeps rendering with no network.
   */
  if (rows.length === 0) {
    return (
      <div className="flex h-full w-full flex-col justify-center">
        <span className="leading-tight opacity-60" style={{ fontSize: boardFontSize(config.size, canvas.width) }}>
          No zmanim for this date
        </span>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative flex h-full w-full flex-col overflow-hidden">
      {/*
        The viewport clips to a whole number of rows; the grid inside holds ALL
        rows and translates up a page at a time. Height is set by the measured
        layout so a partial row never peeks in at the bottom.
      */}
      <div
        ref={viewportRef}
        data-zmanim-viewport
        className="w-full overflow-hidden"
        style={{ height: layout.pageHeightPx === null ? undefined : `${layout.pageHeightPx}px` }}
      >
        <div style={{ transform: `translateY(${-page * (layout.pageHeightPx ?? 0)}px)`, transition: "transform 400ms ease" }}>
          {/*
            A FOUR-COLUMN GRID — the hour, the ":MM" and the meridiem each get
            their own `max-content` track shared by every row, so the hours
            right-align against a common colon and the outer edge is straight.
            The `1fr` label track takes the slack.
          */}
          <div ref={gridRef} className="grid w-full" style={{ gridTemplateColumns: GRID_COLUMNS, columnGap: 0 }}>
            {rows.map((row) => (
              <Row key={row.id} row={row} label={labelOf(row)} />
            ))}
          </div>
        </div>
      </div>

      {/* Footnotes (opt-in) and the source credit, held out of the paging area
          and pinned to the bottom. */}
      <div ref={chromeRef} className="mt-auto flex shrink-0 flex-col">
        {footnotes.length > 0 && (
          <div
            className="flex flex-col opacity-60"
            style={{ fontSize: `${FOOTNOTE_SCALE}em`, marginTop: "0.6em", gap: "0.2em" }}
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
          style={{ fontSize: `${ATTRIBUTION_SCALE}em`, marginTop: "0.6em" }}
        >
          Zmanim from Chabad.org
        </span>
      </div>
    </div>
  );
}

type ZmanimLayout = { fontPx: number; rowsPerPage: number; pageHeightPx: number | null };

/**
 * Measures the box and computes the width-capped type size and the whole-rows
 * page height — ./fit.ts has the arithmetic; this is only the DOM measurement.
 *
 * The font size is written straight to the box's style (imperative, so a resize
 * drag re-measures every frame without a re-render); the page height and rows
 * per page come back as state because they change what the render clips.
 */
function useZmanimLayout(options: {
  boxRef: RefObject<HTMLElement | null>;
  gridRef: RefObject<HTMLElement | null>;
  chromeRef: RefObject<HTMLElement | null>;
  canvasWidth: number;
  configSize: number;
  rowCount: number;
  signature: string;
}): ZmanimLayout {
  const { boxRef, gridRef, chromeRef, canvasWidth, configSize, rowCount, signature } = options;
  const [layout, setLayout] = useState<ZmanimLayout>({ fontPx: 0, rowsPerPage: rowCount || 1, pageHeightPx: null });
  const pendingFrame = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const box = boxRef.current;
    const grid = gridRef.current;
    if (!box || !grid || rowCount === 0) return;

    const measure = () => {
      const boxWidthPx = box.clientWidth;
      const boxHeightPx = box.clientHeight;
      if (boxWidthPx === 0 || boxHeightPx === 0) return;

      // A known size to measure the size-independent ratios at, in this box's
      // own cqw context at whatever zoom the editor is at.
      const ref = resolveDesignPx(100, canvasWidth, box);
      if (ref <= 0) return;
      box.style.fontSize = `${ref}px`;

      // Widest row's full width, at max-content so a long label is measured at
      // its true length rather than truncated by the 1fr track.
      const previousWidth = grid.style.width;
      grid.style.width = "max-content";
      const widthPerFontPx = grid.getBoundingClientRect().width / ref;
      grid.style.width = previousWidth;

      // Per-row height (rows don't wrap, so every row is the same height), and
      // the footnote+attribution chrome height — both as ratios of the font.
      const rowHeightPerFontPx = grid.getBoundingClientRect().height / rowCount / ref;
      const chromePerFontPx = chromeRef.current ? chromeRef.current.getBoundingClientRect().height / ref : 0;

      const fontPx = zmanimFontPx(
        { configPx: resolveDesignPx(configSize, canvasWidth, box), boxWidthPx, widthPerFontPx },
        {
          minPx: resolveDesignPx(manifest.sizing.minFontSize ?? 6, canvasWidth, box),
          maxPx: resolveDesignPx(manifest.sizing.maxFontSize ?? 400, canvasWidth, box),
        },
      );
      box.style.fontSize = `${fontPx}px`;

      const rowHeightPx = rowHeightPerFontPx * fontPx;
      const availableHeightPx = Math.max(0, boxHeightPx - chromePerFontPx * fontPx);
      const perPage = rowsPerPage(availableHeightPx, rowHeightPx);
      const pageHeightPx = Math.min(perPage, rowCount) * rowHeightPx;

      setLayout((previous) =>
        previous.rowsPerPage === perPage &&
        previous.pageHeightPx !== null &&
        Math.abs(previous.pageHeightPx - pageHeightPx) < 0.5 &&
        Math.abs(previous.fontPx - fontPx) < 0.5
          ? previous
          : { fontPx, rowsPerPage: perPage, pageHeightPx },
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
  }, [boxRef, gridRef, chromeRef, canvasWidth, configSize, rowCount, signature]);

  return layout;
}

/**
 * One row: the provider's own label and time string, neither translated by us
 * (§5c: "never re-round or recompute provider output. Display verbatim").
 *
 * Four grid cells rather than a wrapper div, so every row's label, hour,
 * minutes and meridiem each share one column: the hour has its own
 * `max-content` track and right-aligns inside it, so a "7" and an "11" put
 * their colons at the same x and the column's outer edge is straight.
 *
 * NEITHER CELL WRAPS — a wrapping label would make one row taller than the
 * others and the per-row height would be wrong. The label truncates instead
 * (`min-w-0 overflow-hidden`), which only bites in a box too small for the
 * content even at the minimum size. Everything is LTR.
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

  // A shape ./display-time.ts doesn't recognise still gets printed, whole,
  // across the three time tracks. Unaligned beats absent on a board.
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
      {/* `pre`, so the provider's own space before "PM" renders as the
          separator instead of being replaced by padding we invented. */}
      <span key="meridiem" className={timeClass} style={{ ...time, whiteSpace: "pre", justifySelf: "end" }}>
        {parts.meridiem}
      </span>
    </>
  );
}

/** The provider's footnote texts, deduped in row order. A day can carry the
 *  same note on two rows and a board should print it once. */
function distinctFootnotes(rows: readonly ResolvedZman[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.footnote) seen.add(row.footnote);
  }
  return [...seen];
}
