"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { useBoardZmanim } from "@/lib/board-zmanim";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import { resolveZmanimTable, type ResolvedZman } from "@/lib/zmanim/resolve-zmanim";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
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

  // Chabad.org is the only source (lib/zmanim/provider.ts), so there is no
  // provider to resolve — `config.provider` and `zmanim.provider` are both
  // unread. What still matters is whether Chabad has a location to look
  // the shul up by.
  const chabadUnconfigured = !zmanim.hasChabadLocation;

  /*
   * `fit` is honest for the table and not for a single row — manifest.ts's
   * sizing note has the whole argument. In `next` the row's own label
   * changes through the day, so a fitted single row rescales several times
   * a day; Settings.tsx recommends `fixed` there rather than switching the
   * mode, and this is the independent half of that: a `next`-mode widget
   * left on `fit` renders at its declared size instead of rescaling.
   */
  const isFit = config.sizingMode === "fit" && config.displayMode === "all";
  const isHug = config.sizingMode === "hug";

  /*
   * Re-resolved every tick, keyed on `second` rather than on a fresh
   * `Date` (which would defeat the memo every render even when the second
   * hasn't moved). `next` mode genuinely needs the tick — the row has to
   * advance the moment one passes — and `all` mode needs it once a day,
   * when the date rolls over; one memo serves both rather than two code
   * paths that can disagree about which day it is.
   */
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

  /*
   * SPACERS ARE WHAT MAKE `fit` RECOMMENDABLE, and they are the whole
   * mechanism behind manifest.ts's reversal of the earlier "fit is refused
   * for the table" conclusion.
   *
   * The problem `fit` had: the fitted type size is a function of what is
   * in the box, and `candle_lighting` and `shabbos_ends` are in the box on
   * some dates and not others — so the table rescaled on Friday and
   * rescaled back on Sunday, which is the least stable thing a
   * most-watched element can do.
   *
   * The fix: pad the measured list to the DECLARED selection count. The
   * declared count is a design-time constant and an upper bound on any
   * day's real count, because a date-conditional row can only be absent,
   * never extra. Friday's returning row lands in a spacer's place and the
   * measurement does not change. A spacer is one row's height of nothing —
   * not a labelled row with a blank time, which is what §5c forbids
   * ("never render a blank row on a screen someone is standing in front
   * of").
   *
   * Only in `fit`. `fixed` has no measurement to stabilise, and in `hug`
   * the box's height IS its content, so a spacer would be visible dead
   * space rather than reserved space inside a frame.
   */
  const spacerCount =
    isFit && config.displayMode === "all" ? Math.max(0, config.zmanim.length - rows.length) : 0;

  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 14,
    maxFontSize: manifest.sizing.maxFontSize ?? 200,
    canvasWidth: canvas.width,
    enabled: isFit,
    /*
     * THE DECLARED COUNT, NOT TODAY'S ROWS. This is the other half of the
     * spacers: with the DOM row count pinned to the declared selection,
     * the fit only has to re-run when the box changes (the hook's own
     * ResizeObserver) or when the gabbai edits the selection. Today's
     * labels and times are deliberately absent from these deps — a
     * re-measure on a label's length is a rescale for a width reason, and
     * a long label clipping (see `Row`) is the answer to that instead.
     */
    deps: [config.zmanim.length],
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
    // The renderer's own chrome, so design.md §5's empty-state rule
    // applies: name the space, say what to do, no mood.
    return <EmptyLocation canvas={canvas} message="No zmanim chosen yet — pick which times to show." />;
  }

  /*
   * Chabad has nothing for any of the selected zmanim on this date.
   *
   * DELIBERATELY NOT AN OFFLINE MESSAGE, and deliberately the same wording
   * shape candle lighting uses. The display route boots from its
   * last-known-good bundle (plan.md §3c) and keeps rendering with no
   * network, so a screen showing this is almost certainly online and
   * simply has no values for that date. "Check the network" would send a
   * gabbai after a problem that isn't there.
   *
   * THIS IS A COMMON STATE NOW, not a corner. It used to take a shul
   * deliberately turning off "Calculate missing times"; with the computed
   * path gone (lib/zmanim/provider.ts) it is what every date past the
   * 92-day warmed window shows, and every date a warm missed. So it is
   * rendered as a deliberate line at the widget's own type size rather
   * than as a small aside — a room should read it as the board saying
   * something, not as the board having failed.
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
        second={second}
        rowCount={rows.length + spacerCount}
        canvasWidth={canvas.width}
      >
        <div
          ref={contentRef}
          className="flex w-full flex-col"
          style={{ fontSize: isFit ? undefined : boardFontSize(config.size, canvas.width) }}
        >
          {/*
            A two-column grid, not a row of flex pairs — and that is the
            whole reason a column of times lines up. `auto` on the second
            track makes every time cell exactly as wide as the widest time,
            so the figures stack; per-row flex would right-align each row's
            time to its own row's width and nothing would align with
            anything. docs/sizing.md §4 asks for tabular figures on numeric
            board content, and a grid is what makes them worth having.

            Both edges are pinned (labels to the left of the box, times to
            the right), which is §3's growth rule satisfied trivially: a
            longer label grows into the gap between the columns and no edge
            moves. There is no alignment control on this widget for the
            same reason — a table's alignment is its column structure.
          */}
          <div className="grid w-full" style={{ gridTemplateColumns: "1fr auto", columnGap: "1em" }}>
            {rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
            {/* See `spacerCount`. Empty grid cells, one row's height each,
                holding the measurement steady in `fit` mode. `aria-hidden`
                because there is nothing to read. */}
            {Array.from({ length: spacerCount }, (_, index) => (
              <SpacerRow key={`spacer-${index}`} />
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
      </OverflowViewport>
    </div>
  );
}

/**
 * What happens to rows that don't fit — `scroll`, `page` or `clip`.
 *
 * BOTH MOVING MODES DRIVE OFF THE MASTER SECOND TICK (lib/tick.ts), and
 * neither creates a timer. plan.md §3e: "one master rAF/second-tick that
 * all time widgets subscribe to. No setInterval accumulation." A display
 * route runs for months, so a widget with its own interval leaks one timer
 * per remount until the TV WebView dies at 3am.
 *
 * BOTH ARE INERT WHEN NOTHING OVERFLOWS, which is why `page` can be the
 * default without putting motion on boards that don't need it.
 *
 * `page` is a PLAIN SWAP, per design.md's motion rule ("motion answers
 * actions only... no staggered reveals"): the translate has no transition,
 * so one screenful is replaced by the next between two frames. A cross-fade
 * at twenty feet reads as a moment of illegibility, not as polish.
 *
 * `scroll` is the one place a transition is right, because the transition
 * IS the content: the tick sets a new target every second and CSS
 * interpolates linearly across that second, which is how a once-a-second
 * clock produces genuinely continuous motion without a rAF loop.
 *
 * THE ARITHMETIC IS IN ./overflow.ts, not here. This component measures
 * and renders; where the list should sit is a pure function of four
 * numbers and a tick, and keeping it in a component would mean it could
 * only ever be tested through a DOM.
 */
function OverflowViewport({
  boxRef,
  contentRef,
  mode,
  second,
  rowCount,
  canvasWidth,
  children,
}: {
  boxRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  mode: ZmanimConfig["overflow"];
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
   * pixels, and the alternative — deriving it from the declared type size
   * and a line-height constant — would be a second, drifting copy of what
   * the browser already knows.
   *
   * SSR renders this once with both at zero, which reads as "nothing
   * overflows" and so as a still, complete table. That is the right first
   * frame; the client corrects it after hydration, same class of gap as
   * Clock's `second === null` placeholder.
   */
  useEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || mode === "clip") return;

    // The width is measured here too, not read off the ref during render:
    // the scroll rate is declared in board design units and has to be
    // converted against the box's real rendered width, and a ref read in a
    // render body is both a lint error and a genuine correctness trap (it
    // holds last frame's value).
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

  const { offset, animate, wrapped } = overflowState({
    mode,
    second,
    boxHeight,
    contentHeight,
    rowCount,
    boxWidth,
    canvasWidth,
  });

  return (
    <div
      className="w-full"
      style={{
        transform: offset === 0 ? undefined : `translateY(${-offset}px)`,
        // Exactly the tick interval, linear: the target moves once a second
        // and the browser fills in the second, which is what makes a
        // once-a-second clock look continuous. `page` never transitions —
        // design.md's plain-swap rule.
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
 * NEITHER IS TRANSLATED. Chabad sends "Latest Shacharit" and this prints
 * "Latest Shacharit"; it sends "7:22 PM" and this prints "7:22 PM" (§5c:
 * "never re-round or recompute provider output. Display verbatim"). The
 * canonical id the gabbai selected never appears on screen — it exists so
 * the board document survives a provider change, not to be read.
 *
 * A row is two grid cells rather than a wrapper div, so the times in every
 * row share one column. That is why this returns a fragment.
 *
 * NEITHER CELL WRAPS, and that is load-bearing rather than cosmetic: the
 * paging mode divides the measured content height by the row count to find
 * one row's height, which is only correct while every row is the same
 * height. A wrapping label would make one row taller and page boundaries
 * would start cutting rows in half. `min-w-0` plus clipping is §3's own
 * overflow answer applied to the width the label has, and §7's reasoning
 * for the time.
 */
function Row({ row }: { row: ResolvedZman }) {
  return (
    <>
      <span className="min-w-0 overflow-hidden leading-snug whitespace-nowrap opacity-80">{row.label}</span>
      {/* Frank Ruhl Libre and `numeric`, same as Clock and candle lighting:
          it is the one face in the product with a real tabular figure set
          (design.md §3's measurement), which is what keeps this column
          from jittering row to row. */}
      <span
        className="numeric font-semibold leading-snug whitespace-nowrap"
        style={{ fontFamily: BOARD_FONTS.sefarim }}
      >
        {row.display}
      </span>
    </>
  );
}

/** One row's height of nothing — see `spacerCount`. A non-breaking space
 *  rather than an empty string so the cell has a line box and therefore a
 *  height; `invisible` rather than `hidden` so it occupies layout. */
function SpacerRow() {
  return (
    <>
      <span aria-hidden className="invisible leading-snug whitespace-nowrap">
        &nbsp;
      </span>
      <span aria-hidden className="invisible leading-snug whitespace-nowrap">
        &nbsp;
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
