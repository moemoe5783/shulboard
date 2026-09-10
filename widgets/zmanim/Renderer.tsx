"use client";

import { useMemo, useRef } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { useBoardZmanim } from "@/lib/board-zmanim";
import { BOARD_FONTS, boardFontSize, boardLength } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import { resolveZmanimTable, type ResolvedZman } from "@/lib/zmanim/resolve-zmanim";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type ZmanimConfig } from "./manifest";

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

  // "inherit" (the default) defers to the board's own resolved provider —
  // dataNeeds (manifest.ts) can't do this resolution itself, since it only
  // ever sees this widget's own config; this is the one place both are in
  // hand.
  const effectiveProvider = config.provider === "inherit" ? zmanim.provider : config.provider;
  const isChabad = effectiveProvider === "chabad";
  const chabadUnconfigured = isChabad && !zmanim.hasChabadLocation;

  /*
   * `all` is a stacked table and must not be fit-scaled — manifest.ts's
   * sizing note and docs/sizing.md §2. Settings.tsx moves the mode to
   * `hug` when `all` is picked; this is the independent second half of
   * that, so a config hand-edited back to `fit` degrades to its declared
   * size rather than rescaling the whole table on the days a
   * date-conditional row appears.
   */
  const isFit = config.sizingMode === "fit" && config.displayMode === "next";

  /*
   * Re-resolved every tick, keyed on `second` rather than on a fresh
   * `Date` (which would defeat the memo every render even when the second
   * hasn't moved). `next` mode genuinely needs the tick — the row has to
   * advance the moment one passes — and `all` mode needs it once a day,
   * when the date rolls over; one memo serves both rather than two code
   * paths that can disagree about which day it is.
   *
   * One call for every provider and every display mode: which source won,
   * whether a row was substituted, whether a value fell back and whether
   * the shul allows a fallback at all is decided in
   * lib/zmanim/resolve-zmanim.ts, not branched here.
   */
  const resolved = useMemo(
    () =>
      second !== null && location
        ? resolveZmanimTable({
            now: new Date(second * 1000),
            ids: config.zmanim,
            provider: effectiveProvider,
            location,
            chabadZmanim: zmanim.chabadZmanim,
            fallbackToCalculated: config.fallbackToCalculated,
            hour12: config.hour12,
          })
        : null,
    [
      second,
      location,
      effectiveProvider,
      zmanim.chabadZmanim,
      config.zmanim,
      config.fallbackToCalculated,
      config.hour12,
    ],
  );

  const rows: ResolvedZman[] =
    config.displayMode === "next"
      ? resolved?.next
        ? [resolved.next]
        : []
      : resolved?.today.status === "ok"
        ? resolved.today.rows
        : [];

  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 14,
    maxFontSize: manifest.sizing.maxFontSize ?? 200,
    canvasWidth: canvas.width,
    enabled: isFit,
    // Which rows are on screen, not the tick. In `next` mode the label
    // length genuinely changes as the day advances ("Netz" then "Latest
    // Shacharit"), so each row has its own fitted size.
    deps: [rows.map((row) => `${row.id}:${row.display}`).join(",")],
  });

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — zmanim need it." />;
  }
  // A distinct gap from the one above, and checked separately for the
  // reason candle-lighting's Renderer gives: lat/long can be set while the
  // ZIP this provider also needs is not, and an unconfigured Chabad widget
  // must never read as "no times for this date," which is a different and
  // temporary condition.
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
   * The shul asked for its own source or nothing, and the source has
   * nothing for any of the selected zmanim on this date.
   *
   * DELIBERATELY NOT AN OFFLINE MESSAGE, and deliberately the same wording
   * shape candle lighting already uses. The display route boots from its
   * last-known-good bundle (plan.md §3c) and keeps rendering with no
   * network, so a screen showing this is almost certainly online and
   * simply has no values for that date. "Check the network" would send a
   * gabbai after a problem that isn't there.
   */
  if (rows.length === 0) {
    return (
      <div className="flex h-full w-full flex-col justify-center">
        <span className="leading-tight opacity-60" style={{ fontSize: boardLength(config.size, canvas.width) }}>
          No zmanim for this date
        </span>
      </div>
    );
  }

  const footnotes = config.showFootnotes ? distinctFootnotes(rows) : [];
  const anyFellBack = rows.some((row) => row.fellBackToHebcal);

  return (
    <div ref={boxRef} className="relative flex h-full w-full flex-col justify-start">
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
          longer label grows into the gap between the columns and no
          edge moves. There is no alignment control on this widget for
          the same reason — a table's alignment IS its column structure.
        */}
        <div className="grid w-full" style={{ gridTemplateColumns: "1fr auto", columnGap: "1em" }}>
          {rows.map((row) => (
            <Row key={row.id} row={row} />
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

      {/* In flow in `hug` and `fixed`, absolute in `fit` — see the
          component's own note on why the position depends on the mode and
          not on the surface. */}
      {anyFellBack && <CalculatedTimesNotice canvas={canvas} inFlow={!isFit} />}
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
 */
function Row({ row }: { row: ResolvedZman }) {
  return (
    <>
      <span className="leading-snug opacity-80">{row.label}</span>
      {/* Frank Ruhl Libre and `numeric`, same as Clock and candle lighting:
          it is the one face in the product with a real tabular figure set
          (design.md §3's measurement), which is what keeps this column
          from jittering row to row. `nowrap` per sizing.md §7 — a wrapped
          clock reads as broken in a way prose never does. */}
      <span
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

/**
 * plan.md §5c: "surface a subtle indicator rather than failing silently,
 * since a wrong zman is worse than a flagged one."
 *
 * Shown when the screen's provider is Chabad and its cache had nothing for
 * at least one row, so that value is @hebcal/core's computation standing
 * in. One notice for the table rather than a marker per row: the board is
 * read from twenty feet and a column of asterisks is noise, while the
 * honest claim — some of these were calculated — is the same either way.
 *
 * `inFlow` IS ABOUT THE SIZING MODE, NOT ABOUT WHICH SURFACE THIS IS —
 * it reads `config.sizingMode`, which is board content, and nothing here
 * can tell the editor from the display route (CLAUDE.md).
 *
 * Absolute is right in `fit` and wrong in the other two. `useFitFontSize`
 * measures `contentRef` against `boxRef`, so an in-flow notice would
 * shrink the times themselves the moment a cache went cold — which is why
 * candle lighting, whose fit mode is its common case, positions this
 * absolutely and always. But a `hug` box's height is exactly its content,
 * so an absolute notice there would sit on top of the last row; and in
 * `fixed`, an in-flow notice that pushes the last row past the frame is
 * §3's documented clip, which is more honest than a notice overlapping a
 * time.
 *
 * This is the renderer's own chrome — the product speaking, not the shul —
 * so it follows CLAUDE.md's chrome rules: one radius from the two-value
 * scale, weight 400, sentence case, no raw colour. `currentColor` for the
 * reason EmptyLocation uses it: a board sets its own text colour on any
 * ground it likes, and a fixed `--ink` here would be invisible on half of
 * them.
 *
 * Not user-removable and no config flag to hide it. A shul cannot opt out
 * of being told its times are computed.
 */
function CalculatedTimesNotice({ canvas, inFlow }: { canvas: { width: number }; inFlow: boolean }) {
  return (
    <span
      className={`rounded-control border-current/25 pointer-events-none border font-regular whitespace-nowrap opacity-60 ${
        inFlow ? "mt-[0.6em] self-start" : "absolute right-0 bottom-0"
      }`}
      style={{
        fontSize: boardLength(16, canvas.width),
        padding: `${boardLength(2, canvas.width)} ${boardLength(6, canvas.width)}`,
      }}
    >
      Showing calculated times
    </span>
  );
}
