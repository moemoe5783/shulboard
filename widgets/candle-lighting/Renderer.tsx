"use client";

import { useMemo, useRef } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { useBoardZmanim } from "@/lib/board-zmanim";
import { BOARD_FONTS, NUMERIC_FONT } from "@/lib/board-theme";
import { formatCountdown, formatEventLabel, formatTimeOfDay } from "@/lib/hebrew/format";
import { boardLength } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import { WEEK_DAYS, resolveCandleLightings, type ResolvedCandleLighting } from "@/lib/zmanim/resolve";
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

  // Chabad.org is the only source (lib/zmanim/provider.ts), so there is no
  // provider to resolve — `config.provider` and `zmanim.provider` are both
  // unread here now. What still matters is whether Chabad has a location
  // to look the shul up by.
  const chabadUnconfigured = !zmanim.hasChabadLocation;

  // Re-resolved every tick: the countdown has to move every minute, and once
  // a candle-lighting time passes, the very next tick has to find the
  // FOLLOWING one (test:hebrew's "advances past an event once it's passed").
  // Keyed on `second`, not `now` — a fresh Date every render would defeat
  // the memo even when the second hasn't actually changed.
  //
  // One call for every display mode: which dates want a candle lighting
  // and which of those Chabad actually published is decided in
  // lib/zmanim/resolve.ts rather than branched here. This always asks for
  // the week — "next only" takes the first entry, since the horizon has to
  // be wide enough to find one either way.
  const resolution = useMemo(
    () =>
      second !== null && location
        ? resolveCandleLightings({
            now: new Date(second * 1000),
            location,
            chabadZmanim: zmanim.chabadZmanim,
            days: WEEK_DAYS,
            includeShabbosEnd: config.showShabbosEnd,
          })
        : null,
    [second, location, zmanim.chabadZmanim, config.showShabbosEnd],
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

  /*
   * FIT TO BOX, ALWAYS — the only sizing mode (manifest.ts). The type shrinks
   * so the whole block (labels, times, countdown, any Shabbos-end rows and the
   * "after" note) fits the box, and no more. A busier week or a smaller box
   * renders smaller rather than clipping.
   *
   * Re-fit whenever the shown entries change: the countdown ticking every
   * minute doesn't need it, but which entries are on screen does — in `rotate`
   * each entry's label has its own length ("Candle lighting" vs a Yom Tov's own
   * name), and the "after" note appears on some entries and not others, so the
   * fitted size is genuinely different per entry. The note text is folded into
   * the signature for that reason.
   */
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 8,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: true,
    deps: [shown.map((entry) => `${entry.time.getTime()}:${entry.kind}:${entry.note ?? ""}`).join(",")],
  });

  // The widget's appearance — background, padding, radius, border, colour, font
  // and an optional header — is applied by BoardRenderer.WidgetFrame around this
  // Renderer (widgets/style.ts), for every widget in one place. This Renderer
  // returns only the time block, and `boxRef` measures the padded, header-less
  // content area WidgetFrame gives it.

  if (!location) {
    return (
      <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — candle lighting needs it." />
    );
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

  return (
    <div ref={boxRef} className={`relative flex h-full w-full flex-col justify-center ${align}`}>
      <div
        ref={contentRef}
        className="flex flex-col"
        style={{
          // No fontSize here — fit-to-box owns it, writing the fitted size to
          // this element's style (useFitFontSize). Every size inside an Entry is
          // in `em`, so the whole block scales off that one number.
          //
          // Between stacked entries only. A single entry keeps the tighter
          // intra-block rhythm it always had.
          gap: shown.length > 1 ? "0.35em" : undefined,
        }}
      >
        {shown.map((entry) => (
          <Entry
            key={`${entry.time.getTime()}:${entry.kind}`}
            entry={entry}
            config={config}
            timeZone={location.timeZone}
            now={now}
          />
        ))}
      </div>

      {/*
        TWO NOTICES USED TO RENDER HERE AND BOTH ARE GONE. Neither removal
        is an oversight, and the reasons are unrelated.

        "Times by Chabad.org" went because the premise was wrong:
        permission for this data was granted by Chabad.org directly and
        they did not ask for attribution. The "Shabbat Times Powered by
        Chabad.org" link in their embed's own markup was an inference from
        that markup, not a stated term. Do not re-add it believing it to be
        a licence requirement.

        "Showing calculated times" went because there is nothing left to
        calculate. Chabad.org is the only source and the Hebcal fallback is
        gone (lib/zmanim/provider.ts), so a date with no published value
        shows the unavailable state above rather than a computed time with
        a caveat attached. An indicator that can never fire is worse than
        no indicator.
      */}
    </div>
  );
}

/** The "after" note's size, relative to a row's own type size — smaller than
 *  the label, since it is a sentence of instruction rather than a heading. */
const NOTE_SCALE = 0.32;

/**
 * One entry: its label, its time, optionally its countdown, and — for the
 * second night of a two-day Yom Tov — the "light candles after this time"
 * instruction the embed carries.
 *
 * Extracted because `all` and `rotate` render the same block one to several
 * times and a single entry has to look identical to how it always did —
 * one shape, so a stacked week and a lone Friday cannot drift apart.
 */
function Entry({
  entry,
  config,
  timeZone,
  now,
}: {
  entry: ResolvedCandleLighting;
  config: CandleLightingConfig;
  timeZone: string;
  now: Date;
}) {
  /*
   * The label NAMES THE OCCASION, which is what tells two entries in one week
   * apart.
   *
   * For a candle lighting: a `CandleLightingEvent`'s own `renderBrief` is
   * "Candle lighting" on every one of them, so a week with a Friday and an Erev
   * Yom Tov would show "Candle lighting" twice, indistinguishable. The Yom Tov
   * name lives on the event's `linkedEvent` (the holiday), so this reads that
   * when there is one and falls back to the event itself — which renders
   * "Candle lighting" — for an ordinary Friday, where `linkedEvent` is
   * undefined (the parsha goes to `.memo`, not here — see @hebcal/core's
   * calendar.js).
   *
   * For a Shabbos/Yom-Tov end: the `HavdalahEvent` itself, whose `renderBrief`
   * is "Havdalah" (translated per script). NOT its `linkedEvent` — that is the
   * holiday, which would read as if this were candle lighting FOR it rather
   * than its end.
   *
   * The TIME is Chabad's in either case; hebcal is the calendar, Chabad is the
   * clock.
   */
  const occasion = entry.kind === "shabbos_ends" ? entry.event : entry.event.linkedEvent ?? entry.event;
  const label = formatEventLabel(occasion, { script: config.script, nekudos: config.nekudos });

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

      {/* The time itself — the numbers face (lib/board-theme.ts), tabular, same as Clock. */}
      <span
        className="numeric font-semibold leading-none whitespace-nowrap"
        style={{ fontFamily: NUMERIC_FONT, fontSize: "1em" }}
      >
        {time}
      </span>

      {/*
        The special instruction, when the embed marked one — the second night
        of a two-day Yom Tov, lit from an existing flame AFTER this time rather
        than before it (lib/zmanim/chabad-embed.ts, resolve.ts). Dropping it
        would tell a room to light at a time it must not; it prints in the
        widget's own text face, small, under the time.
      */}
      {entry.note && (
        <span className="leading-tight opacity-70" style={{ fontSize: `${NOTE_SCALE}em` }}>
          {entry.note}
        </span>
      )}

      {config.showCountdown && (
        <span
          className="numeric leading-tight whitespace-nowrap opacity-80"
          style={{ fontFamily: NUMERIC_FONT, fontSize: `${COUNTDOWN_SCALE}em` }}
        >
          {countdown}
        </span>
      )}
    </div>
  );
}
