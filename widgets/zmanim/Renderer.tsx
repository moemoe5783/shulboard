"use client";

import { useEffect, useMemo, useRef, type CSSProperties, type RefObject } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { useBoardZmanim } from "@/lib/board-zmanim";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import { resolveZmanimTable, type ResolvedZman } from "@/lib/zmanim/resolve-zmanim";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { resolveDesignPx, resolveDesignUnits } from "../useFitFontSize";
import { splitTimeColumns } from "./display-time";
import { fitFontSizePx } from "./fit";
import { manifest, type ZmanimConfig } from "./manifest";

/** The footnote block, relative to a row's own type size. Small — it is a
 *  sentence of prose sitting under a table of figures, and it must never
 *  compete with the times. */
const FOOTNOTE_SCALE = 0.5;

/**
 * The gap between the label column and the time column.
 *
 * NOT `column-gap`: the times are three tracks (hours, ":MM", meridiem — see
 * `Row`) that must sit flush against each other, which one grid `column-gap`
 * cannot express. So the gap is padding on the time cell adjacent to the label,
 * and the grid's own gap is zero. In `em`, so it scales with the type and the
 * fit measurement reads it as part of the row width it fits.
 */
const LABEL_GAP = "1em";

/**
 * The row grid's tracks: the label takes the slack, each piece of the time
 * takes exactly what it needs. The label is track one; the times follow left
 * to right. Both label forms are Latin and LTR, so nothing reorders these.
 */
const GRID_COLUMNS = "1fr max-content max-content max-content";

export function Renderer({ config, canvas }: WidgetRendererProps<ZmanimConfig>) {
  const location = useBoardLocation();
  const zmanim = useBoardZmanim();
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  /** The whole table (grid + footnotes) — the fit reads its natural height. */
  const contentRef = useRef<HTMLDivElement>(null);
  /** The row grid alone — the fit reads the widest row's natural width off it
   *  at `max-content`, which is what keeps a long label from truncating. */
  const gridRef = useRef<HTMLDivElement>(null);

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
   * FIT TO BOX, ALWAYS. The type shrinks so the whole table — every row's full
   * text and all the rows stacked — fits the box, and no more (./fit.ts). It is
   * the only sizing mode: a busier day or a smaller box renders smaller rather
   * than clipping or scrolling. The signature re-measures whenever the rows or
   * the footnotes change, since both change the content's size.
   */
  useZmanimFit({
    boxRef,
    gridRef,
    contentRef,
    canvasWidth: canvas.width,
    signature: `${rows.map(labelOf).join("|")}::${footnotes.join("|")}`,
  });

  // The widget's appearance — background, padding, radius, border, colour, font
  // and an optional header — is applied by BoardRenderer.WidgetFrame around this
  // Renderer (widgets/style.ts), for every widget in one place. This Renderer
  // returns only the table itself, and `boxRef` measures the padded, header-less
  // content area WidgetFrame gives it, which is exactly what the fit needs.

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
   * state (everything past the warmed window, and every date a warm missed),
   * deliberately not an offline message: the display boots from its
   * last-known-good bundle and keeps rendering with no network, so a screen
   * showing this is almost certainly online and simply has no value for the
   * date.
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
    <div
      ref={boxRef}
      // overflow-hidden is the last-resort clip if the content doesn't fit even
      // at the minimum size (rare — fit shrinks to fit first). The fitted type
      // size is written straight to this element by `useZmanimFit`.
      className="relative flex h-full w-full flex-col justify-start overflow-hidden"
    >
      <div ref={contentRef} className="flex w-full flex-col">
        {/*
          A FOUR-COLUMN GRID, which is the whole reason the times form a clean
          edge: the hour, the ":MM" and the meridiem each get their own
          `max-content` track shared by every row, so the hours right-align
          against a common colon and the outer edge is straight whatever the
          hour's width. The `1fr` label track takes the slack.
        */}
        <div ref={gridRef} className="grid w-full" style={{ gridTemplateColumns: GRID_COLUMNS, columnGap: 0 }}>
          {rows.map((row) => (
            <Row key={row.id} row={row} label={labelOf(row)} />
          ))}
        </div>

        {footnotes.length > 0 && (
          <div
            className="flex flex-col opacity-60"
            style={{ fontSize: `${FOOTNOTE_SCALE}em`, marginTop: "0.8em", gap: "0.2em" }}
          >
            {footnotes.map((text) => (
              <span key={text} className="leading-tight">
                {text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The Zmanim table's fit — ./fit.ts has the rules. Fits BOTH axes so the whole
 * table is visible and shrinks to fit, never clipped or scrolled.
 *
 * NOT `useFitFontSize`, deliberately. That hook measures `scrollWidth` against
 * the box, which a `1fr`-stretched grid always reports as the box's own width —
 * so a long label would silently truncate instead of driving the size down.
 * This measures the grid's `max-content` width instead (the widest row's real
 * width), and the content's natural height, and takes the closed-form min: for
 * rows that do not wrap both scale linearly with font size, so one measurement
 * gives the exact answer and no binary search is needed.
 *
 * The result is written straight to the box's style rather than through state,
 * so the ResizeObserver can re-measure on every frame of a resize drag without
 * a re-render, and it is safe because nothing else React owns touches that
 * property.
 */
function useZmanimFit(options: {
  boxRef: RefObject<HTMLElement | null>;
  gridRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  canvasWidth: number;
  signature: string;
}) {
  const { boxRef, gridRef, contentRef, canvasWidth, signature } = options;
  const pendingFrame = useRef<number | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    const grid = gridRef.current;
    const content = contentRef.current;
    if (!box || !grid || !content) return;

    const measure = () => {
      const boxWidthPx = box.clientWidth;
      const boxHeightPx = box.clientHeight;
      if (boxWidthPx === 0 || boxHeightPx === 0) return;

      // A known size to measure at — any size works, the ratios below are
      // size-independent — resolved to real pixels in this box's own `cqw`
      // context at whatever zoom the editor happens to be at.
      const reference = resolveDesignPx(100, canvasWidth, box);
      if (reference <= 0) return;
      box.style.fontSize = `${reference}px`;

      // The whole content's natural height (grid rows plus any footnote block).
      // Rows don't wrap, so this doesn't depend on the width and can be read at
      // the normal layout.
      const heightPerFontPx = content.getBoundingClientRect().height / reference;

      // The widest row's full width, at `max-content` so a long label is
      // measured at its true length rather than truncated by the `1fr` track.
      const previousWidth = grid.style.width;
      grid.style.width = "max-content";
      const widthPerFontPx = grid.getBoundingClientRect().width / reference;
      grid.style.width = previousWidth;

      const fitted = fitFontSizePx(
        { boxWidthPx, boxHeightPx, widthPerFontPx, heightPerFontPx },
        {
          minPx: resolveDesignPx(manifest.sizing.minFontSize ?? 6, canvasWidth, box),
          maxPx: resolveDesignPx(manifest.sizing.maxFontSize ?? 200, canvasWidth, box),
        },
      );

      box.style.fontSize = `${fitted}px`;

      // The properties panel reads this to show and drive the type size — plain
      // DOM state rather than a prop back through the shared renderer contract
      // (components/editor/useElementFontSize.ts).
      box.dataset.fittedSize = String(Math.round(resolveDesignUnits(fitted, canvasWidth, box)));
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
  }, [boxRef, gridRef, contentRef, canvasWidth, signature]);
}

/**
 * One row: the provider's own label and time string, neither translated by us
 * (§5c: "never re-round or recompute provider output. Display verbatim").
 *
 * Four grid cells rather than a wrapper div, so every row's label, hour,
 * minutes and meridiem each share one column: the hour has its own
 * `max-content` track and right-aligns inside it, so a "7" and an "11" put
 * their colons at the same x and the column's outer edge is straight.
 * ./display-time.ts does the split and the pieces rejoin to the exact string.
 *
 * NEITHER CELL WRAPS — a wrapping label would make one row taller than the
 * others and the fit's per-row height would be wrong. The label truncates
 * instead (`min-w-0 overflow-hidden`), which only bites in a box too small for
 * the content even at the minimum size. Everything is LTR.
 */
function Row({ row, label }: { row: ResolvedZman; label: string }) {
  const parts = splitTimeColumns(row.display);

  const gap: CSSProperties = { paddingLeft: LABEL_GAP };
  const time: CSSProperties = { fontFamily: BOARD_FONTS.sefarim };
  /*
   * Frank Ruhl Libre with `numeric`. The face is measured, not assumed:
   * scripts/test-font-parity.mjs reads `11111` against `00000` in the real
   * board and finds the sefarim face closes a 6.97px spread to 0.00px under
   * `tabular-nums` while the UI face is unchanged at 3.08px either way. So the
   * figures within a track line up because of this face; the tracks line the
   * hours up with each other.
   */
  const timeClass = "numeric font-semibold leading-snug whitespace-nowrap";

  const labelCell = (
    <span key="label" className="min-w-0 overflow-hidden leading-snug whitespace-nowrap opacity-80">
      {label}
    </span>
  );

  // A shape ./display-time.ts doesn't recognise still gets printed, whole,
  // across the three time tracks. Unaligned beats absent on a board somebody is
  // standing in front of.
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
