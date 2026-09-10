"use client";

import { useMemo, useRef } from "react";
import type { CandleLightingEvent } from "@hebcal/core";
import { useBoardLocation } from "@/lib/board-location";
import { useBoardZmanim } from "@/lib/board-zmanim";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { formatCandleLightingLabel, formatCountdown, formatEventLabel, formatTimeOfDay } from "@/lib/hebrew/format";
import { boardLength } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import { WEEK_DAYS, resolveCandleLightings } from "@/lib/zmanim/resolve";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type CandleLightingConfig } from "./manifest";

const LABEL_SCALE = 0.4;
const COUNTDOWN_SCALE = 0.45;

/**
 * Seconds each entry holds in `rotate` mode.
 *
 * Eight, and it is a legibility number rather than a taste one: a
 * congregant glancing up needs long enough to read a label and a time and
 * register that it changed, and this is the same box a countdown ticks a
 * new value into every minute, so anything much faster reads as flicker
 * rather than rotation.
 */
const ROTATE_SECONDS = 8;

export function Renderer({ config, canvas }: WidgetRendererProps<CandleLightingConfig>) {
  const location = useBoardLocation();
  const zmanim = useBoardZmanim();
  const second = useSecond();
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const now = second === null ? null : new Date(second * 1000);

  // "inherit" (the default) defers to the board's own resolved provider —
  // dataNeeds (manifest.ts) can't do this resolution itself, since it only
  // ever sees this widget's own config, never the screen/org context
  // "inherit" defers to; this is the one place both are in hand.
  const effectiveProvider = config.provider === "inherit" ? zmanim.provider : config.provider;
  const isChabad = effectiveProvider === "chabad";
  const chabadUnconfigured = isChabad && !zmanim.hasChabadLocation;

  /*
   * "all" is stacked and must not be fit-scaled — see manifest.ts's note on
   * displayMode and docs/sizing.md §2. Settings.tsx switches sizingMode to
   * hug when the mode is picked; this is the second half of that, so a
   * config hand-edited back to `fit` degrades to the declared size instead
   * of rescaling between a one-entry week and a three-entry one and
   * overflowing at minFontSize.
   */
  const isFit = config.sizingMode === "fit" && config.displayMode !== "all";

  // Re-resolved every tick: the countdown has to move every minute, and once
  // a candle-lighting time passes, the very next tick has to find the
  // FOLLOWING one (test:hebrew's "advances past an event once it's passed").
  // Keyed on `second`, not `now` — a fresh Date every render would defeat
  // the memo even when the second hasn't actually changed.
  //
  // One call for every provider and every display mode: which source wins,
  // whether a date fell back, and whether the shul allows a fallback at all
  // is decided in lib/zmanim/resolve.ts rather than branched here. This
  // always asks for the week — "next only" takes the first entry, since the
  // horizon has to be wide enough to find one either way.
  const resolution = useMemo(
    () =>
      second !== null && location
        ? resolveCandleLightings({
            now: new Date(second * 1000),
            provider: effectiveProvider,
            location,
            chabadZmanim: zmanim.chabadZmanim,
            manualMinutesBeforeSunset: config.manualMinutesBeforeSunset,
            days: WEEK_DAYS,
            fallbackToCalculated: config.fallbackToCalculated,
          })
        : null,
    [
      second,
      location,
      effectiveProvider,
      zmanim.chabadZmanim,
      config.manualMinutesBeforeSunset,
      config.fallbackToCalculated,
    ],
  );

  const entries = resolution?.status === "ok" ? resolution.entries : [];

  /*
   * Which entries this mode actually shows.
   *
   * `rotate` steps off the master second tick (lib/tick.ts) rather than its
   * own setInterval — plan.md §3e: "one master rAF/second-tick that all
   * time widgets subscribe to. No setInterval accumulation." Integer
   * division of the tick means every rotating widget on the board advances
   * on the same boundary, and a screen that has been up for months has
   * accumulated nothing to leak.
   */
  const rotateIndex = second === null ? 0 : Math.floor(second / ROTATE_SECONDS);
  const shown =
    config.displayMode === "all"
      ? entries
      : config.displayMode === "rotate" && entries.length > 0
        ? [entries[rotateIndex % entries.length]]
        : entries.slice(0, 1);

  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 14,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: isFit,
    // The countdown ticks every minute without the box needing to resize —
    // only which entries are on screen is worth re-fitting for. In `rotate`
    // that legitimately includes the rotation itself: each entry's label
    // has its own length ("Candle lighting" vs a Yom Tov's own name), so
    // the fitted size is genuinely different per entry.
    deps: [shown.map((entry) => entry.time.getTime()).join(",")],
  });

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — candle lighting needs it." />;
  }
  // A distinct gap from the one above: lat/long can be set while the
  // separate ZIP/Chabad-location fields this provider also needs are not —
  // see the proposal this was built from for why these don't collapse into
  // one message. Checked first: an unconfigured Chabad widget should never
  // read as "no time for this date," which is a different and temporary
  // condition.
  if (chabadUnconfigured) {
    return (
      <EmptyLocation
        canvas={canvas}
        message="This shul hasn't set a ZIP or Chabad.org location yet — candle lighting needs it."
      />
    );
  }

  const align =
    config.align === "center"
      ? "items-center text-center"
      : config.align === "right"
        ? "items-end text-right"
        : "items-start text-left";

  /*
   * The shul asked for its own source or nothing, and the source has
   * nothing for this date.
   *
   * DELIBERATELY NOT AN OFFLINE MESSAGE. The display route boots from its
   * last-known-good bundle (plan.md §3c) and keeps rendering with no
   * network at all, so a screen showing this is almost certainly online —
   * it simply has no value for that date — either past the end of the
   * warmed window (92 days, lib/zmanim/warm.ts) or because the cron has
   * never run for this location at all. "Check the
   * network" would send a gabbai after a problem that isn't there, and
   * "offline" is a condition this product handles somewhere else entirely.
   *
   * The wording says the true thing and stops: there is no time for this
   * date. It is read by a room, not only by a gabbai, so it stays calm and
   * factual rather than diagnostic — no error prefix, no apology, no
   * instruction to anyone walking past.
   */
  if (resolution?.status === "unavailable") {
    return (
      <div className={`flex h-full w-full flex-col justify-center ${align}`}>
        <span
          className="leading-tight opacity-60"
          /* Scaled off the widget's own declared type size rather than a
             fixed number, so it sits at the same visual weight as the
             label it stands in for. `boardFontSize` returns a CSS length,
             so the arithmetic is on the design unit, not on its output. */
          style={{ fontSize: boardLength(config.size * LABEL_SCALE, canvas.width) }}
        >
          No candle lighting time for this date
        </span>
      </div>
    );
  }

  if (!now || shown.length === 0) return null;

  const anyFellBack = shown.some((entry) => entry.fellBackToHebcal);

  return (
    <div ref={boxRef} className={`relative flex h-full w-full flex-col justify-center ${align}`}>
      <div
        ref={contentRef}
        className="flex flex-col"
        style={{
          fontSize: isFit ? undefined : boardFontSize(config.size, canvas.width),
          // Between stacked entries only. A single entry keeps the tighter
          // intra-block rhythm it always had.
          gap: shown.length > 1 ? "0.35em" : undefined,
        }}
      >
        {shown.map((entry) => (
          <Entry
            key={entry.time.getTime()}
            entry={entry}
            config={config}
            timeZone={location.timeZone}
            now={now}
          />
        ))}
      </div>

      {/*
        THERE IS NO CHABAD ATTRIBUTION HERE, AND THAT IS NOT AN OVERSIGHT.

        A "Times by Chabad.org" notice used to render alongside this one
        whenever the value came from Chabad. It is gone because the premise
        was wrong: permission for this data was granted by Chabad.org
        directly and they did not ask for attribution. The "Shabbat Times
        Powered by Chabad.org" link in their embed's own markup was an
        inference from that markup, not a stated term of the permission.

        So do not re-add it believing it to be a licence requirement. If
        Chabad.org ever does ask for a credit, that is a new instruction
        and this comment is not it.
      */}
      {anyFellBack && <CalculatedTimesNotice canvas={canvas} />}
    </div>
  );
}

/**
 * One candle lighting: its label, its time, and optionally its countdown.
 *
 * Extracted because `all` and `rotate` render the same block one to three
 * times and a single entry has to look identical to how it always did —
 * one shape, so a stacked week and a lone Friday cannot drift apart.
 */
function Entry({
  entry,
  config,
  timeZone,
  now,
}: {
  entry: { time: Date; event: CandleLightingEvent | null; fellBackToHebcal: boolean };
  config: CandleLightingConfig;
  timeZone: string;
  now: Date;
}) {
  // A Hebcal-produced value carries its own event name (a Yom Tov's, not
  // just "Candle lighting"); a value read out of Chabad's cache doesn't, so
  // it gets the generic label. This makes a fallback-produced value label
  // exactly like an ordinary Hebcal one — the indicator, not the label, is
  // what says it was computed.
  const label = entry.event
    ? formatEventLabel(entry.event, { script: config.script, nekudos: config.nekudos })
    : formatCandleLightingLabel({ script: config.script, nekudos: config.nekudos });

  const time = formatTimeOfDay(entry.time, { hour12: config.hour12, timeZone });
  const countdown = formatCountdown(entry.time.getTime() - now.getTime());

  return (
    <div className="flex flex-col gap-[0.1em]">
      {label.hebrew && (
        <span
          dir="rtl"
          lang="he"
          className="font-semibold leading-tight opacity-80"
          style={{ fontFamily: BOARD_FONTS.sefarim, fontSize: `${LABEL_SCALE}em` }}
        >
          {label.hebrew}
        </span>
      )}
      {label.english && (
        <span className="leading-tight opacity-80" style={{ fontSize: `${LABEL_SCALE}em` }}>
          {label.english}
        </span>
      )}

      {/* The time itself — Frank Ruhl Libre, tabular, same as Clock. */}
      <span
        className="numeric font-semibold leading-none whitespace-nowrap"
        style={{ fontFamily: BOARD_FONTS.sefarim, fontSize: "1em" }}
      >
        {time}
      </span>

      {config.showCountdown && (
        <span
          className="numeric leading-tight whitespace-nowrap opacity-80"
          style={{ fontFamily: BOARD_FONTS.sefarim, fontSize: `${COUNTDOWN_SCALE}em` }}
        >
          {countdown}
        </span>
      )}
    </div>
  );
}

/**
 * plan.md §5c: "surface a subtle indicator rather than failing silently,
 * since a wrong zman is worse than a flagged one."
 *
 * Shown when the screen's provider is Chabad and its cache had nothing for
 * the date about to happen, so this time is Hebcal's own computation
 * standing in. Rarer than it was — the window is 92 days now (WARM_DAYS
 * in lib/zmanim/warm.ts) rather than four weeks — but still by design for
 * any date past it, and still the state a location whose cron has never
 * run sits in. It is the only signal on the board that a time was
 * calculated rather than fetched, which is why it stays.
 *
 * This is the renderer's own chrome — the product speaking, not the shul —
 * so it follows CLAUDE.md's chrome rules: one radius from the two-value
 * scale, weight 400, sentence case, no raw colour. It borrows
 * `currentColor` for the same reason EmptyLocation and the unknown-widget
 * notice do: a board sets its own text colour on any ground it likes, and
 * a fixed `--ink` here would be invisible on half of them.
 *
 * Not user-removable, and no config flag to hide it. The board document is
 * the shul's to author (design.md §1b), but this is not part of it — a
 * shul cannot opt out of being told its times are computed.
 *
 * Absolutely positioned, deliberately — `useFitFontSize` measures
 * `contentRef` against `boxRef`, so anything in the normal flow would
 * shrink the time itself the moment a cache went cold.
 */
function CalculatedTimesNotice({ canvas }: { canvas: { width: number } }) {
  return (
    <span
      className="rounded-control border-current/25 pointer-events-none absolute right-0 bottom-0 border font-regular whitespace-nowrap opacity-60"
      style={{
        fontSize: boardLength(16, canvas.width),
        padding: `${boardLength(2, canvas.width)} ${boardLength(6, canvas.width)}`,
      }}
    >
      Showing calculated times
    </span>
  );
}
