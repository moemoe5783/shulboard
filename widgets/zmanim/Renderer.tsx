"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { useBoardZmanim } from "@/lib/board-zmanim";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import { resolveZmanimTable, type ResolvedZman } from "@/lib/zmanim/resolve-zmanim";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { resolveDesignPx, resolveDesignUnits } from "../useFitFontSize";
import { fitFontSizePx } from "./fit";
import { manifest, type ZmanimConfig } from "./manifest";
import { overflowState } from "./overflow";

/** The footnote block, relative to a row's own type size. Small — it is a
 *  sentence of prose sitting under a table of figures, and it must never
 *  compete with the times. */
const FOOTNOTE_SCALE = 0.5;

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
    contentRef,
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
    >
      <OverflowViewport
        boxRef={boxRef}
        contentRef={contentRef}
        mode={isHug ? "clip" : config.overflow}
        speed={config.scrollSpeed}
        second={second}
        rowCount={rows.length}
        canvasWidth={canvas.width}
      >
        <div
          ref={contentRef}
          className="flex w-full flex-col"
          // In `fit` the size is written straight to this element's style
          // by useZmanimFit — see its note on why that is not React state.
          style={{ fontSize: isFit ? undefined : boardFontSize(config.size, canvas.width) }}
        >
          {/*
            A TWO-COLUMN GRID, and that is the whole reason the times form a
            clean right edge. `auto` on the second track makes every time
            cell exactly as wide as the widest time, so the figures stack in
            one column; a flex pair per row would right-align each row's
            time to its own row and nothing would line up with anything.
            `1fr` on the first track gives the label the slack, so a long
            label grows into the gutter and neither edge moves — docs/
            sizing.md §3's growth rule, satisfied by the geometry.

            RTL MIRRORS IT, and one attribute is the whole implementation:
            `direction: rtl` puts the first grid item in the RIGHT track, so
            the labels move to the right edge and the times form their
            column on the left, which is where a Hebrew reader's eye
            starts. The track sizes keep their jobs unchanged.
          */}
          <div
            ref={gridRef}
            dir={isHebrew ? "rtl" : "ltr"}
            className="grid w-full"
            style={{ gridTemplateColumns: "1fr auto", columnGap: "1em" }}
          >
            {rows.map((row) => (
              <Row key={row.id} row={row} label={labelOf(row)} isHebrew={isHebrew && row.hebrewLabel !== null} />
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
 * overflow and never lets width clip, which is a different question with a
 * closed-form answer — for rows that do not wrap, width and row height
 * both scale linearly with font size, so ONE measurement at a known size
 * gives exact ratios and no search is needed.
 *
 * The result is written straight to the element's style rather than
 * returned through state, for the reason `useFitFontSize` gives: it lets
 * the ResizeObserver re-measure on every frame of a resize drag without a
 * re-render each time, and it is safe because nothing else React owns
 * touches that property.
 */
function useZmanimFit(options: {
  boxRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  gridRef: RefObject<HTMLElement | null>;
  canvasWidth: number;
  enabled: boolean;
  rowCount: number;
  signature: string;
}) {
  const { boxRef, contentRef, gridRef, canvasWidth, enabled, rowCount, signature } = options;
  const pendingFrame = useRef<number | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    const grid = gridRef.current;
    if (!enabled || !box || !content || !grid || rowCount === 0) return;

    const measure = () => {
      if (box.clientWidth === 0 || box.clientHeight === 0) return;

      // A known size to measure at. Any size works — the ratios below are
      // size-independent — and a design-unit probe is what makes it a real
      // pixel value in this box's own `cqw` context at whatever zoom the
      // editor happens to be at.
      const reference = resolveDesignPx(100, canvasWidth, box);
      if (reference <= 0) return;
      content.style.fontSize = `${reference}px`;

      /*
       * MEASURED AT `max-content`, briefly. The grid's label cell clips
       * (`min-w-0 overflow-hidden`, which is what stops a long label
       * pushing the times off the box), so at its normal width the `1fr`
       * track shrinks the label rather than overflowing — and `scrollWidth`
       * would report the box's width back, not the text's. Letting the grid
       * size to its content for the length of one measurement is the only
       * way to read the natural width the width rule needs.
       */
      const previousWidth = grid.style.width;
      grid.style.width = "max-content";
      const naturalWidth = grid.getBoundingClientRect().width;
      const naturalHeight = grid.getBoundingClientRect().height;
      grid.style.width = previousWidth;

      const fitted = fitFontSizePx(
        {
          boxHeightPx: box.clientHeight,
          boxWidthPx: box.clientWidth,
          widthPerFontPx: naturalWidth / reference,
          rowHeightPerFontPx: naturalHeight / Math.max(1, rowCount) / reference,
        },
        {
          minPx: resolveDesignPx(manifest.sizing.minFontSize ?? 14, canvasWidth, box),
          maxPx: resolveDesignPx(manifest.sizing.maxFontSize ?? 200, canvasWidth, box),
        },
      );

      content.style.fontSize = `${fitted}px`;

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
  }, [boxRef, contentRef, gridRef, canvasWidth, enabled, rowCount, signature]);
}

/**
 * What happens to rows that don't fit — `scroll`, `page` or `clip`.
 *
 * BOTH MOVING MODES DRIVE OFF THE MASTER SECOND TICK (lib/tick.ts) and
 * neither creates a timer. plan.md §3e: "one master rAF/second-tick that
 * all time widgets subscribe to. No setInterval accumulation." A display
 * route runs for months, so a widget with its own interval leaks one timer
 * per remount until the TV WebView dies at 3am.
 *
 * BOTH ARE INERT WHEN NOTHING OVERFLOWS, which is why `page` can be the
 * default without putting motion on boards that don't need it.
 *
 * `page` is a PLAIN SWAP, per design.md's motion rule: the translate has no
 * transition, so one screenful is replaced by the next between two frames.
 * A cross-fade at twenty feet reads as a moment of illegibility.
 *
 * `scroll` is the one place a transition is right, because the transition
 * IS the content: the tick sets a new target every second and CSS
 * interpolates linearly across that second, which is how a once-a-second
 * clock produces continuous motion without a rAF loop.
 *
 * THE ARITHMETIC IS IN ./overflow.ts, not here. This component measures and
 * renders; where the list should sit is a pure function of four numbers and
 * an elapsed time.
 */
function OverflowViewport({
  boxRef,
  contentRef,
  mode,
  speed,
  second,
  rowCount,
  canvasWidth,
  children,
}: {
  boxRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  mode: ZmanimConfig["overflow"];
  speed: ZmanimConfig["scrollSpeed"];
  second: number | null;
  rowCount: number;
  canvasWidth: number;
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
   * WHERE THE SCROLL STARTS FROM, and the fix for a real reported bug: "on
   * load it scrolls through the list very fast, then slows almost to a
   * stop."
   *
   * The offset used to be `(second * speed) % contentHeight` off the
   * absolute epoch tick. That is in range, so nothing looked wrong, but its
   * value at any moment is arbitrary — and the frame before measurement has
   * no offset at all. So the first measured frame jumped from 0 to whatever
   * the epoch produced (224px, measured, at the old 16 units/second on a
   * 504-unit list) and CSS interpolated the whole distance over one second:
   * a fourteen-times sweep, then a settle to the real rate, which reads as
   * stopping.
   *
   * An origin makes the first frame's elapsed time zero by construction.
   * It is re-taken whenever anything the cycle is computed FROM changes —
   * the mode, the speed, the row count, the measured box or content — so a
   * resize restarts from the top rather than jumping to a new arbitrary
   * point mid-cycle.
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

  const { offset, animate, wrapped } = overflowState({
    mode,
    elapsedSeconds,
    boxHeight,
    contentHeight,
    rowCount,
    boxWidth,
    canvasWidth,
    speed,
  });

  return (
    <div
      className="w-full"
      style={{
        transform: offset === 0 ? undefined : `translateY(${-offset}px)`,
        // Exactly the tick interval, linear: the target moves once a second
        // and the browser fills in the second, which is what makes a
        // once-a-second clock look continuous. `page` never transitions —
        // design.md's plain-swap rule. Suppressed on the frame the scroll
        // wraps, or CSS would animate the whole list backwards.
        transition: animate && !wrapped ? "transform 1s linear" : undefined,
      }}
    >
      {children}
      {/* The seam. A second copy of the list means the moment the offset
          reaches the first copy's full height, what is on screen is
          pixel-identical to the offset being zero — so the reset is
          invisible. Rendered only while actually scrolling, so a static
          table has no duplicate in the DOM to confuse a measurement.
          `aria-hidden` because it is the same content twice. */}
      {animate && (
        <div aria-hidden className="w-full">
          {children}
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
 * A row is two grid cells rather than a wrapper div, so the times in every
 * row share one column. That is why this returns a fragment.
 *
 * NEITHER CELL WRAPS, and that is load-bearing rather than cosmetic: the
 * paging mode divides measured content height by row count to find one
 * row's height, which is only correct while every row is the same height,
 * and the fit measures one row's height the same way. A wrapping label
 * would make one row taller and page boundaries would start cutting rows in
 * half. Horizontal clipping is the last resort behind that — ./fit.ts's
 * width rule shrinks the type first, and only a box too narrow at
 * `minFontSize` reaches the clip.
 */
function Row({ row, label, isHebrew }: { row: ResolvedZman; label: string; isHebrew: boolean }) {
  return (
    <>
      <span
        /*
         * `lang` and `dir` on the CELL, not only on the grid. A Hebrew
         * label inside an RTL grid still needs its own direction declared
         * for the browser to order it correctly — and a row that fell back
         * to English inside an RTL table needs the opposite, which is a
         * distinction only the cell can express.
         */
        {...(isHebrew ? { lang: "he", dir: "rtl" as const } : { dir: "ltr" as const })}
        className="min-w-0 overflow-hidden leading-snug whitespace-nowrap opacity-80"
      >
        {label}
      </span>
      {/*
        ALWAYS LTR, in either script, and Frank Ruhl Libre with `numeric`.

        The direction: a clock time is Latin digits in a fixed order, and
        rendering it right-to-left would turn "7:22 PM" into something no
        luach prints. Item 3's mirroring is about which SIDE the column
        sits on, not the order inside a cell.

        The face: measured, not assumed. scripts/test-font-parity.mjs reads
        `11111` against `00000` in the real board and finds the sefarim face
        closes a 6.97px spread to 0.00px under `tabular-nums` while the UI
        face is unchanged at 3.08px either way — which is CLAUDE.md's
        caveat, still true on the board. So the clean right edge comes from
        setting this face, not from the utility class alone.
      */}
      <span
        dir="ltr"
        className="numeric font-semibold leading-snug whitespace-nowrap"
        style={{ fontFamily: BOARD_FONTS.sefarim }}
      >
        {row.display}
      </span>
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
