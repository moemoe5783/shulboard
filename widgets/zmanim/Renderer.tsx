"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
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
import { overflowState } from "./overflow";

/** The footnote block, relative to a row's own type size. Small — it is a
 *  sentence of prose sitting under a table of figures, and it must never
 *  compete with the times. */
const FOOTNOTE_SCALE = 0.5;

/**
 * The gap between the label column and the time column.
 *
 * NOT `column-gap`, and that is deliberate rather than awkward. The times
 * are three tracks now (hours, ":MM", meridiem — see `Row`) and those three
 * must sit flush against each other, which a single grid `column-gap`
 * cannot express: one value applies to every gap in the row. So the gap is
 * padding on whichever time cell is adjacent to the label, and the grid's
 * own gap is zero.
 *
 * In `em`, so it scales with the type and so the fit measurement below
 * reads it as part of the width it protects.
 */
const LABEL_GAP = "1em";

/**
 * The row grid's tracks: the label takes the slack, each piece of the time
 * takes exactly what it needs.
 *
 * THE LABEL IS ALWAYS TRACK ONE, in both scripts, because it is always the
 * first cell emitted — which is what lets the fit measurement below read
 * the label's used track width out of `gridTemplateColumns` and subtract
 * it. Mirroring for Hebrew is done by `dir` plus the cell order in `Row`,
 * not by reordering these.
 */
const GRID_COLUMNS = "1fr max-content max-content max-content";

export function Renderer({ config, canvas }: WidgetRendererProps<ZmanimConfig>) {
  const location = useBoardLocation();
  const zmanim = useBoardZmanim();
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** The row grid alone, without the footnote block — the fit reads one
   *  row's height off it, so a footnote paragraph must never end up in the
   *  denominator. */
  const gridRef = useRef<HTMLDivElement>(null);

  // Chabad.org is the only source (lib/zmanim/provider.ts), so there is no
  // provider to resolve. What still matters is whether Chabad has a
  // location to look the shul up by.
  const chabadUnconfigured = !zmanim.hasChabadLocation;

  /*
   * `fit` is honest for the table and not for a single row — manifest.ts's
   * sizing note has the whole argument, and ./fit.ts has the rules. In
   * `next` the row's own label changes through the day, so a
   * width-constrained single row rescales several times a day;
   * Settings.tsx recommends `fixed` there rather than switching the mode,
   * and this is the independent half of that.
   */
  const isFit = config.sizingMode === "fit" && config.displayMode === "all";
  const isHug = config.sizingMode === "hug";

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

  const isHebrew = config.labelScript === "hebrew";
  const labelOf = (row: ResolvedZman) => (isHebrew ? row.hebrewLabel ?? row.label : row.label);

  /*
   * THE SPACER ROWS ARE GONE. They padded the measured list to the declared
   * selection count so the old fit's size could not move when a
   * date-conditional row appeared. The size no longer depends on the row
   * count at all (./fit.ts), so they had nothing left to hold steady — and
   * a spacer would now actively hurt, inflating the content height the
   * overflow check reads and scrolling a table that genuinely fits.
   */
  useZmanimFit({
    boxRef,
    gridRef,
    canvasWidth: canvas.width,
    enabled: isFit,
    rowCount: rows.length,
    /*
     * The LABELS, not the times. The size is a function of the box and of
     * one row's geometry, so what can change it is a label long enough to
     * bind the width term — a returning "Candle Lighting" row, or the whole
     * table switching to Hebrew. The times cannot: they are tabular figures
     * of fixed width (measured, see scripts/test-font-parity.mjs), which is
     * exactly why they share one column. Re-measuring every tick would be
     * work for nothing on a screen that runs for months.
     */
    signature: rows.map(labelOf).join("|"),
  });

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — zmanim need it." />;
  }
  // A distinct gap from the one above, and checked separately for the
  // reason candle-lighting's Renderer gives: lat/long can be set while the
  // ZIP Chabad needs is not, and an unconfigured widget must never read as
  // "no times for this date," which is a different and temporary
  // condition.
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
   * Chabad has nothing for any of the selected zmanim on this date.
   *
   * DELIBERATELY NOT AN OFFLINE MESSAGE, and deliberately the same wording
   * shape candle lighting uses. The display route boots from its
   * last-known-good bundle (plan.md §3c) and keeps rendering with no
   * network, so a screen showing this is almost certainly online and
   * simply has no values for that date.
   *
   * THIS IS A COMMON STATE, not a corner: everything past the 92-day
   * warmed window, and every date a warm missed. So it is a deliberate
   * line at the widget's own type size rather than a small aside — a room
   * should read it as the board saying something, not as the board having
   * failed.
   */
  if (rows.length === 0) {
    return (
      <div className="flex h-full w-full flex-col justify-center">
        <span
          className="leading-tight opacity-60"
          style={{ fontSize: boardFontSize(config.size, canvas.width) }}
        >
          No zmanim for this date
        </span>
      </div>
    );
  }

  const footnotes = config.showFootnotes ? distinctFootnotes(rows) : [];

  /*
   * The table, built twice: once for real and once for the scroll seam.
   *
   * A FUNCTION RATHER THAN ONE ELEMENT RENDERED IN TWO PLACES, and that is
   * the fix for a real reported bug — "switching into fit from another mode
   * stops it resizing entirely." The seam used to be `{children}` rendered
   * a second time inside `OverflowViewport`. React mounts two DOM nodes from
   * one element descriptor and attaches every ref inside it twice, so
   * `gridRef.current` ended up pointing at the HIDDEN copy (it commits
   * last) — and unmounting it nulled the ref outright. In `fixed`/`hug`
   * nothing showed, because React writes the type size through the style
   * prop and both copies got it; in `fit` the measured size was written
   * imperatively to the copy nobody could see, and the visible table sat at
   * its inherited size forever.
   *
   * Only one copy carries the refs now. The other is identical and inert.
   */
  const table = (attachRefs: boolean) => (
    <div ref={attachRefs ? contentRef : undefined} className="flex w-full flex-col">
      {/*
        A FOUR-COLUMN GRID, and that is the whole reason the times form a
        clean edge.

        The times are three tracks, not one, and that is the fix for "7:22
        PM and 11:21 AM don't line up." Right-aligning the whole string
        cannot line them up — the strings are different lengths, so a
        two-digit hour hangs a digit out past every single-digit one, no
        matter how tabular the figures are. Splitting the hour into its own
        `max-content` track shared by every row, and right-aligning inside
        it, puts the colon at one fixed x for the whole table; ":MM" and the
        meridiem then follow in their own tracks and the outer edge is
        straight whatever the hour's width.

        `1fr` on the label track gives the label the slack, so a long label
        grows into the gutter and neither edge moves — docs/sizing.md §3's
        growth rule, satisfied by the geometry. It is also the track that
        absorbs a narrow box, which is what lets ./fit.ts stop shrinking the
        type the moment the box is narrower than ideal.

        RTL MIRRORS IT with `dir` plus the cell order in `Row`: `direction:
        rtl` lays track one out on the RIGHT, so the labels move to the
        right edge and the time's three tracks form their column on the
        left, where a Hebrew reader's eye starts. `Row` emits the time cells
        in reverse for that case so the time still reads hour, minutes,
        meridiem from left to right — a clock time is Latin digits in a
        fixed order and no luach prints it backwards.
      */}
      <div
        ref={attachRefs ? gridRef : undefined}
        dir={isHebrew ? "rtl" : "ltr"}
        className="grid w-full"
        style={{ gridTemplateColumns: GRID_COLUMNS, columnGap: 0 }}
      >
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            label={labelOf(row)}
            labelIsHebrew={isHebrew && row.hebrewLabel !== null}
            mirrored={isHebrew}
          />
        ))}
      </div>

      {footnotes.length > 0 && (
        <div
          dir={isHebrew ? "rtl" : "ltr"}
          className="flex flex-col opacity-60"
          style={{ fontSize: `${FOOTNOTE_SCALE}em`, marginTop: "0.8em", gap: "0.2em" }}
        >
          {/* The footnote TEXT is Chabad's English either way — the
              response carries no Hebrew for it — so only the block's
              own alignment mirrors, not the words. */}
          {footnotes.map((text) => (
            <span key={text} dir="ltr" className="leading-tight">
              {text}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={boxRef}
      /*
       * `overflow-hidden` is what both overflow modes translate inside, and
       * it is also §3's clip for `clip` mode — one mechanism, three
       * behaviours. Not applied in `hug`, where the box is its content and
       * there is nothing to clip.
       */
      className={`relative flex h-full w-full flex-col justify-start ${isHug ? "" : "overflow-hidden"}`}
      /*
       * THE TYPE SIZE LIVES ON THE BOX, not on the content, so that both
       * copies of the table inherit it — the seam is only invisible while
       * the two copies are the same size. In `fit` this property is written
       * straight to this element by `useZmanimFit`; React leaves it alone
       * there (`undefined` on every render, so nothing to diff), which is
       * what lets a resize drag re-measure every frame without a re-render.
       */
      style={{ fontSize: isFit ? undefined : boardFontSize(config.size, canvas.width) }}
    >
      <OverflowViewport
        boxRef={boxRef}
        contentRef={contentRef}
        mode={isHug ? "clip" : config.overflow}
        speed={config.scrollSpeed}
        second={second}
        rowCount={rows.length}
        canvasWidth={canvas.width}
        seam={table(false)}
      >
        {table(true)}
      </OverflowViewport>
    </div>
  );
}

/**
 * `fit` mode's own measurement — ./fit.ts has the rules and the reasoning.
 *
 * NOT `useFitFontSize`, and that is the point rather than duplication. That
 * hook implements docs/sizing.md §2's fit: a binary search for the largest
 * size at which content fits BOTH axes. This widget's fit lets height
 * overflow and never lets the times clip, which is a different question
 * with a closed-form answer — for rows that do not wrap, width and row
 * height both scale linearly with font size, so ONE measurement at a known
 * size gives exact ratios and no search is needed.
 *
 * The result is written straight to the box's style rather than returned
 * through state, for the reason `useFitFontSize` gives: it lets the
 * ResizeObserver re-measure on every frame of a resize drag without a
 * re-render each time, and it is safe because nothing else React owns
 * touches that property.
 */
function useZmanimFit(options: {
  boxRef: RefObject<HTMLElement | null>;
  gridRef: RefObject<HTMLElement | null>;
  canvasWidth: number;
  enabled: boolean;
  rowCount: number;
  signature: string;
}) {
  const { boxRef, gridRef, canvasWidth, enabled, rowCount, signature } = options;
  const pendingFrame = useRef<number | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    const grid = gridRef.current;
    if (!enabled || !box || !grid || rowCount === 0) return;

    const measure = () => {
      const boxWidthPx = box.clientWidth;
      const boxHeightPx = box.clientHeight;
      if (boxWidthPx === 0 || boxHeightPx === 0) return;

      // A known size to measure at. Any size works — the ratios below are
      // size-independent — and a design-unit probe is what makes it a real
      // pixel value in this box's own `cqw` context at whatever zoom the
      // editor happens to be at.
      const reference = resolveDesignPx(100, canvasWidth, box);
      if (reference <= 0) return;
      box.style.fontSize = `${reference}px`;

      /*
       * MEASURED AT `max-content`, briefly. The grid's label cell clips
       * (`min-w-0 overflow-hidden`, which is what stops a long label
       * pushing the times off the box), so at its normal width the `1fr`
       * track shrinks the label rather than overflowing — and `scrollWidth`
       * would report the box's width back, not the text's. Letting the grid
       * size to its content for the length of one measurement is the only
       * way to read the natural geometry the rules need.
       */
      const previousWidth = grid.style.width;
      grid.style.width = "max-content";
      const natural = grid.getBoundingClientRect();
      /*
       * THE USED TRACK SIZES, which is how the width rule gets told what it
       * is allowed to give up.
       *
       * `gridTemplateColumns` computes to the resolved track widths in px,
       * and `GRID_COLUMNS` puts the label in track one in both scripts. So
       * the whole natural width minus that track is exactly the time
       * column plus the gap that separates it from the label (the gap is
       * padding inside the adjacent time cell — see `LABEL_GAP`), which is
       * the width ./fit.ts protects. Subtracting rather than measuring a
       * cell directly keeps this correct when a row falls back to printing
       * an unrecognised string across all three time tracks.
       */
      const tracks = getComputedStyle(grid)
        .gridTemplateColumns.split(/\s+/)
        .map((track) => Number.parseFloat(track));
      grid.style.width = previousWidth;

      const labelTrack = Number.isFinite(tracks[0]) ? tracks[0] : 0;
      // Falls back to the whole width if the subtraction produces nothing
      // usable — a conservative answer (it shrinks sooner) rather than an
      // unconstrained one.
      const protectedWidth = natural.width - labelTrack > 0 ? natural.width - labelTrack : natural.width;

      const fitted = fitFontSizePx(
        {
          boxHeightPx,
          boxWidthPx,
          protectedWidthPerFontPx: protectedWidth / reference,
          rowHeightPerFontPx: natural.height / Math.max(1, rowCount) / reference,
        },
        {
          minPx: resolveDesignPx(manifest.sizing.minFontSize ?? 14, canvasWidth, box),
          maxPx: resolveDesignPx(manifest.sizing.maxFontSize ?? 200, canvasWidth, box),
        },
      );

      box.style.fontSize = `${fitted}px`;

      // docs/sizing.md: the properties panel shows an objective, read-only
      // type size in fit mode. Plain DOM state rather than a prop back
      // through WidgetRendererProps — the panel is editor-only and the
      // renderer contract is shared with the display route, which has no
      // panel to feed. Read by components/editor/useElementFontSize.ts.
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
  }, [boxRef, gridRef, canvasWidth, enabled, rowCount, signature]);
}

/**
 * What happens to rows that don't fit the box — `scroll`, `page` or `clip`.
 *
 * NEITHER MOVING MODE CREATES A TIMER. plan.md §3e: "one master rAF/
 * second-tick that all time widgets subscribe to. No setInterval
 * accumulation." A display route runs for months, so a widget with its own
 * interval leaks one timer per remount until the TV WebView dies at 3am.
 * `page` steps off the master second tick (lib/tick.ts); `scroll` hands CSS
 * a duration and reads no clock at all, which accumulates even less.
 *
 * BOTH ARE INERT WHEN NOTHING OVERFLOWS, which is why `page` can be the
 * default without putting motion on boards that don't need it.
 *
 * `page` is a PLAIN SWAP, per design.md's motion rule: the translate has no
 * transition, so one screenful is replaced by the next between two frames.
 * A cross-fade at twenty feet reads as a moment of illegibility.
 *
 * `scroll` IS A CSS ANIMATION OVER TWO COPIES OF THE LIST, and the pair is
 * the mechanism rather than a trick: `translateY(-50%)` of a two-copy stack
 * is exactly one copy, so the end of a cycle is pixel-identical to its
 * start and the loop closes with no seam to hide. It replaced a
 * once-a-second transitioned target, which could not close that loop — see
 * ./overflow.ts's scroll branch for the measurement.
 *
 * THE ARITHMETIC IS IN ./overflow.ts, not here. This component measures and
 * renders; where the list should sit, or how fast it should cycle, is a
 * pure function of four numbers and an elapsed time.
 */
function OverflowViewport({
  boxRef,
  contentRef,
  mode,
  speed,
  second,
  rowCount,
  canvasWidth,
  seam,
  children,
}: {
  boxRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  mode: ZmanimConfig["overflow"];
  speed: ZmanimConfig["scrollSpeed"];
  second: number | null;
  rowCount: number;
  canvasWidth: number;
  /** A second, ref-free copy of `children`, rendered only while scrolling.
   *  Passed in rather than rendered from `children` twice — the Renderer's
   *  `table` explains what that cost. */
  seam: React.ReactNode;
  children: React.ReactNode;
}) {
  const [{ boxHeight, boxWidth, contentHeight }, setMeasured] = useState({
    boxHeight: 0,
    boxWidth: 0,
    contentHeight: 0,
  });

  /*
   * One ResizeObserver over both boxes. Measurement is unavoidable here in
   * a way it is not for sizing: how many rows fit is a fact about rendered
   * pixels, and deriving it from the declared type size and a line-height
   * constant would be a second, drifting copy of what the browser knows.
   *
   * The width is measured here too, not read off a ref during render: the
   * scroll rate is declared in board design units and has to be converted
   * against the box's real rendered width, and a ref read in a render body
   * is both a lint error and a genuine correctness trap.
   *
   * SSR renders this once with everything at zero, which reads as "nothing
   * overflows" and so as a still, complete table. That is the right first
   * frame; the client corrects it after hydration, the same class of gap as
   * Clock's `second === null` placeholder.
   */
  useEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || mode === "clip") return;

    const measure = () =>
      setMeasured((previous) =>
        previous.boxHeight === box.clientHeight &&
        previous.boxWidth === box.clientWidth &&
        previous.contentHeight === content.scrollHeight
          ? previous
          : { boxHeight: box.clientHeight, boxWidth: box.clientWidth, contentHeight: content.scrollHeight },
      );

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, [boxRef, contentRef, mode, rowCount]);

  /*
   * WHERE PAGING STARTS FROM. `page` reads an elapsed time rather than the
   * absolute tick so it opens on page one instead of on whichever page the
   * wall clock lands on, and the origin is re-taken whenever anything the
   * cycle is computed FROM changes — the mode, the row count, the measured
   * box or content — so a resize restarts from the top rather than jumping
   * mid-cycle.
   *
   * This was originally the fix for a scroll bug ("on load it scrolls
   * through the list very fast, then slows almost to a stop"); scroll no
   * longer reads a clock, and ./overflow.ts's scroll branch has that whole
   * history.
   *
   * ADJUSTED DURING RENDER, not in an effect. React's own
   * state-derived-from-props pattern, and the same one
   * components/editor/NumberField.tsx uses: setting state in an effect is
   * both a wasted committed frame and what the React compiler lint refuses
   * outright. The condition is a key comparison, so it settles in one
   * extra render pass and never loops.
   */
  const cycleKey = `${mode}:${speed}:${rowCount}:${Math.round(boxHeight)}:${Math.round(contentHeight)}`;
  const [origin, setOrigin] = useState<{ key: string; second: number } | null>(null);

  if (second !== null && (origin === null || origin.key !== cycleKey)) {
    setOrigin({ key: cycleKey, second });
  }

  const elapsedSeconds =
    second === null || origin === null || origin.key !== cycleKey ? null : second - origin.second;

  const { offset, animate, scrollSeconds } = overflowState({
    mode,
    elapsedSeconds,
    boxHeight,
    contentHeight,
    rowCount,
    boxWidth,
    canvasWidth,
    speed,
  });

  /*
   * Two shapes, never both. Scrolling is one declarative animation over the
   * two-copy stack; paging is a bare translate with no transition at all.
   *
   * `zmanim-scroll` is in app/globals.css, and `-50%` there is why the seam
   * needs exactly two copies — no measured height is involved in closing
   * the loop, so a stale measurement can only change the speed, never
   * reintroduce a jump.
   */
  const motion: CSSProperties = animate
    ? { animation: `zmanim-scroll ${scrollSeconds}s linear infinite` }
    : { transform: offset === 0 ? undefined : `translateY(${-offset}px)` };

  return (
    <div className="w-full" style={motion}>
      {children}
      {/* The seam. A second copy of the list is what makes the wrap
          invisible: at `-50%` of the pair, what is on screen is
          pixel-identical to `0`. Rendered only while actually scrolling, so
          a static table has no duplicate in the DOM to confuse a
          measurement. `aria-hidden` because it is the same content twice. */}
      {animate && (
        <div aria-hidden className="w-full">
          {seam}
        </div>
      )}
    </div>
  );
}

/**
 * One row: the provider's own label, and the provider's own time string.
 *
 * NEITHER IS TRANSLATED BY US. Chabad sends "Latest Shacharit" and this
 * prints "Latest Shacharit"; it sends "סוף זמן תפילה" and this prints that;
 * it sends "7:22 PM" and this prints "7:22 PM" (§5c: "never re-round or
 * recompute provider output. Display verbatim"). The canonical id the
 * gabbai selected never appears on screen — it exists so the board document
 * survives a provider change, not to be read.
 *
 * A row is four grid cells rather than a wrapper div, so every row's label,
 * hour, minutes and meridiem each share one column with every other row's.
 * That is why this returns a fragment, and it is also the whole of the
 * alignment: the hour has its own `max-content` track and right-aligns
 * inside it, so a "7" and an "11" put their colons at the same x and the
 * outer edge of the column is straight. ./display-time.ts does the split,
 * and the pieces rejoin to the provider's exact string — laying the same
 * characters out in columns is display, not reformatting.
 *
 * NEITHER CELL WRAPS, and that is load-bearing rather than cosmetic: the
 * paging mode divides measured content height by row count to find one
 * row's height, which is only correct while every row is the same height,
 * and the fit measures one row's height the same way. A wrapping label
 * would make one row taller and page boundaries would start cutting rows in
 * half. Horizontal clipping of the LABEL is the deliberate absorber behind
 * that — ./fit.ts protects the time column and lets a long label truncate
 * rather than shrinking the whole table in a narrow box.
 */
function Row({
  row,
  label,
  labelIsHebrew,
  mirrored,
}: {
  row: ResolvedZman;
  label: string;
  labelIsHebrew: boolean;
  mirrored: boolean;
}) {
  const parts = splitTimeColumns(row.display);

  /*
   * Which way "flush against the next piece" points, and where the gap
   * from the label goes. In a mirrored table the tracks lay out right to
   * left, so the inline start of a cell is its right-hand side — which is
   * the side the hour has to hug to reach its colon, and the side the
   * meridiem has to hug for the column's outer edge to be straight.
   */
  const flush = mirrored ? ("start" as const) : ("end" as const);
  const gap: CSSProperties = mirrored ? { paddingRight: LABEL_GAP } : { paddingLeft: LABEL_GAP };
  const time: CSSProperties = { fontFamily: BOARD_FONTS.sefarim };
  /*
   * ALWAYS LTR, in either script, and Frank Ruhl Libre with `numeric`.
   *
   * The direction: a clock time is Latin digits in a fixed order, and
   * rendering it right-to-left would turn "7:22 PM" into something no
   * luach prints. Mirroring is about which SIDE the column sits on and the
   * order the cells are emitted in, never the order inside a cell.
   *
   * The face: measured, not assumed. scripts/test-font-parity.mjs reads
   * `11111` against `00000` in the real board and finds the sefarim face
   * closes a 6.97px spread to 0.00px under `tabular-nums` while the UI
   * face is unchanged at 3.08px either way — which is CLAUDE.md's caveat,
   * still true on the board. So the figures within a track line up because
   * of this face; the tracks are what line the hours up with each other.
   */
  const timeClass = "numeric font-semibold leading-snug whitespace-nowrap";

  const labelCell = (
    <span
      key="label"
      /*
       * `lang` and `dir` on the CELL, not only on the grid. A Hebrew
       * label inside an RTL grid still needs its own direction declared
       * for the browser to order it correctly — and a row that fell back
       * to English inside an RTL table needs the opposite, which is a
       * distinction only the cell can express.
       */
      {...(labelIsHebrew ? { lang: "he", dir: "rtl" as const } : { dir: "ltr" as const })}
      className="min-w-0 overflow-hidden leading-snug whitespace-nowrap opacity-80"
    >
      {label}
    </span>
  );

  // A shape ./display-time.ts doesn't recognise still gets printed, whole,
  // across the three time tracks. Unaligned beats absent on a board
  // somebody is standing in front of.
  if (!parts) {
    return (
      <>
        {labelCell}
        <span
          dir="ltr"
          className={timeClass}
          style={{ ...time, ...gap, gridColumn: "span 3", justifySelf: flush }}
        >
          {row.display}
        </span>
      </>
    );
  }

  const hours = (
    <span
      key="hours"
      dir="ltr"
      className={timeClass}
      style={{ ...time, justifySelf: flush, ...(mirrored ? null : gap) }}
    >
      {parts.hours}
    </span>
  );
  const minutes = (
    <span key="minutes" dir="ltr" className={timeClass} style={time}>
      {parts.minutes}
    </span>
  );
  const meridiem = (
    <span
      key="meridiem"
      dir="ltr"
      className={timeClass}
      // `pre`, so the provider's own space before "PM" renders as the
      // separator instead of being replaced by padding we invented.
      style={{ ...time, whiteSpace: "pre", justifySelf: flush, ...(mirrored ? gap : null) }}
    >
      {parts.meridiem}
    </span>
  );

  return (
    <>
      {labelCell}
      {mirrored ? [meridiem, minutes, hours] : [hours, minutes, meridiem]}
    </>
  );
}

/** The provider's footnote texts, deduped in row order. `LaterMincha` sits
 *  on one row and `MenorahLighting` on another, but a day can carry the
 *  same note on two rows and a board should print it once. */
function distinctFootnotes(rows: readonly ResolvedZman[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.footnote) seen.add(row.footnote);
  }
  return [...seen];
}
