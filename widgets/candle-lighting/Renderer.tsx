"use client";

import { useMemo, useRef } from "react";
import { useBoardLocation } from "@/lib/board-location";
import { useBoardZmanim } from "@/lib/board-zmanim";
import { BOARD_FONTS, boardFontSize } from "@/lib/board-theme";
import { formatCandleLightingLabel, formatCountdown, formatEventLabel, formatTimeOfDay } from "@/lib/hebrew/format";
import { boardLength } from "@/lib/board-theme";
import { useSecond } from "@/lib/tick";
import { resolveCandleLighting } from "@/lib/zmanim/resolve";
import { EmptyLocation } from "../hebrew/EmptyLocation";
import type { WidgetRendererProps } from "../types";
import { useFitFontSize } from "../useFitFontSize";
import { manifest, type CandleLightingConfig } from "./manifest";

const LABEL_SCALE = 0.4;
const COUNTDOWN_SCALE = 0.45;

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

  // Re-resolved every tick: the countdown has to move every minute, and once
  // a candle-lighting time passes, the very next tick has to find the
  // FOLLOWING one (test:hebrew's "advances past an event once it's passed").
  // Keyed on `second`, not `now` — a fresh Date every render would defeat
  // the memo even when the second hasn't actually changed.
  //
  // One call for every provider: which source wins, and whether Chabad fell
  // back to Hebcal for the date about to happen, is decided in
  // lib/zmanim/resolve.ts rather than branched here.
  const resolution = useMemo(
    () =>
      second !== null && location
        ? resolveCandleLighting({
            now: new Date(second * 1000),
            provider: effectiveProvider,
            location,
            chabadZmanim: zmanim.chabadZmanim,
            manualMinutesBeforeSunset: config.manualMinutesBeforeSunset,
          })
        : null,
    [second, location, effectiveProvider, zmanim.chabadZmanim, config.manualMinutesBeforeSunset],
  );

  const resolved =
    resolution && {
      time: resolution.time,
      fellBackToHebcal: resolution.fellBackToHebcal,
      source: resolution.source,
      // A Hebcal-produced value carries its own event name (a Yom Tov's,
      // not just "Candle lighting"); a value read out of Chabad's cache
      // doesn't, so it gets the generic label. Note this makes a
      // fallback-produced value label exactly like an ordinary Hebcal one —
      // the indicator below, not the label, is what says it was computed.
      label: resolution.event
        ? formatEventLabel(resolution.event, { script: config.script, nekudos: config.nekudos })
        : formatCandleLightingLabel({ script: config.script, nekudos: config.nekudos }),
    };

  const isFit = config.sizingMode === "fit";
  useFitFontSize(boxRef, contentRef, {
    minFontSize: manifest.sizing.minFontSize ?? 14,
    maxFontSize: manifest.sizing.maxFontSize ?? 400,
    canvasWidth: canvas.width,
    enabled: isFit,
    // The countdown ticks every minute without the box needing to resize —
    // only the event identity (a new Friday) is worth re-fitting for.
    deps: [resolved ? resolved.time.getTime() : null],
  });

  if (!location) {
    return <EmptyLocation canvas={canvas} message="This shul hasn't set a location yet — candle lighting needs it." />;
  }
  // A distinct gap from the one above: lat/long can be set while the
  // separate ZIP/Chabad-location fields this provider also needs are not —
  // see the proposal this was built from for why these don't collapse into
  // one message. Checked before `!resolved` below: an unconfigured Chabad
  // widget should never read as "no time yet," which is what an ordinary,
  // temporary cache-not-warmed-yet gap looks like.
  if (chabadUnconfigured) {
    return (
      <EmptyLocation
        canvas={canvas}
        message="This shul hasn't set a ZIP or Chabad.org location yet — candle lighting needs it."
      />
    );
  }
  if (!now || !resolved) return null;

  const { label, time: eventTime, fellBackToHebcal, source } = resolved;
  const time = formatTimeOfDay(eventTime, { hour12: config.hour12, timeZone: location.timeZone });
  const countdown = formatCountdown(eventTime.getTime() - now.getTime());

  const align =
    config.align === "center"
      ? "items-center text-center"
      : config.align === "right"
        ? "items-end text-right"
        : "items-start text-left";

  return (
    <div ref={boxRef} className={`relative flex h-full w-full flex-col justify-center ${align}`}>
      <div
        ref={contentRef}
        className="flex flex-col gap-[0.1em]"
        style={{ fontSize: isFit ? undefined : boardFontSize(config.size, canvas.width) }}
      >
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

      {/* Mutually exclusive by construction: a fallback value is Hebcal's,
          so `source` is never "chabad" when `fellBackToHebcal` is true.
          They share the corner and can never collide there. */}
      {fellBackToHebcal && <CornerNotice canvas={canvas}>Showing calculated times</CornerNotice>}
      {source === "chabad" && <CornerNotice canvas={canvas}>Times by Chabad.org</CornerNotice>}
    </div>
  );
}

/**
 * The one corner of this widget that is the PRODUCT speaking, not the shul.
 *
 * Two messages use it, never both at once:
 *
 * - "Showing calculated times" — plan.md §5c: "surface a subtle indicator
 *   rather than failing silently, since a wrong zman is worse than a
 *   flagged one." Shown when the screen's provider is Chabad and its cache
 *   had nothing for the date about to happen, so this time is Hebcal's
 *   computation standing in.
 * - "Times by Chabad.org" — the attribution condition on Chabad.org's
 *   published candle-lighting embed, whose own markup carries a "Shabbat
 *   Times Powered by Chabad.org" link (lib/zmanim/chabad-embed.ts). This
 *   is a licence term, not decoration.
 *
 * WHY IT LIVES INSIDE THE WIDGET, per instance, rather than once per board:
 * it travels with the data it credits. A board showing two zmanim widgets
 * from different sources credits each correctly, and the credit disappears
 * on its own the moment the value stops being Chabad's — which is exactly
 * what happens on a fallback. A single board-level credit would be wrong
 * in both of those cases and would put product chrome somewhere the shul
 * cannot move it.
 *
 * NOT USER-REMOVABLE, and there is deliberately no config flag to hide it.
 * The board document is the shul's to author (design.md §1b), but this is
 * not part of it — a shul cannot license away Chabad.org's condition by
 * unticking a box, and an editor-only credit would breach it precisely
 * where the publication happens, on the screen.
 *
 * This is the renderer's own chrome, so it follows CLAUDE.md's chrome
 * rules — one radius from the two-value scale, weight 400, sentence case,
 * no raw colour. It borrows `currentColor` for the same reason
 * EmptyLocation and the unknown-widget notice do: a board sets its own
 * text colour on any ground it likes, and a fixed `--ink` here would be
 * invisible on half of them.
 *
 * Absolutely positioned, deliberately — `useFitFontSize` measures
 * `contentRef` against `boxRef`, so anything in the normal flow would
 * shrink the time itself the moment a cache went cold or a provider
 * changed.
 */
function CornerNotice({ canvas, children }: { canvas: { width: number }; children: string }) {
  return (
    <span
      className="rounded-control border-current/25 pointer-events-none absolute right-0 bottom-0 border font-regular whitespace-nowrap opacity-60"
      style={{
        fontSize: boardLength(16, canvas.width),
        padding: `${boardLength(2, canvas.width)} ${boardLength(6, canvas.width)}`,
      }}
    >
      {children}
    </span>
  );
}
