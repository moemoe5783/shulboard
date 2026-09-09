import type { CandleLightingEvent } from "@hebcal/core";
import type { BoardLocation } from "@/lib/board-location";
// Relative and extensioned, the way lib/hebrew's own modules import each
// other (candle-times.ts's `./civil-day.ts`): this is the one non-type
// import here, and it has to resolve under plain `node` for
// scripts/test-zmanim-fallback.ts, which has no bundler to read tsconfig's
// `@/` alias.
import { upcomingCandleLighting } from "../hebrew/candle-times.ts";
import type { ChabadEmbedZman } from "./chabad-embed";

/*
 * plan.md §5c's fallback chain — "requested provider → cache → Hebcal
 * (client-side, always works) → last known good" — for the one zman that
 * has a provider today, `candle_lighting`.
 *
 * Client-safe, no fetch, no server-only import (only the *type* from
 * chabad-embed.ts, erased at compile time). Nothing here parses a
 * provider response: the Chabad side of this reads an already-parsed dict,
 * so the adapter's own parsing logic is not involved in, and does not
 * change for, any of the fallback behavior below.
 *
 * candle-lighting/Renderer.tsx is the only caller, and it calls this for
 * every provider rather than branching itself — the whole point is that the
 * decision of which source produced the value, and whether that was a
 * fallback, is made in one pure function that a test can drive directly.
 */

export type ChabadZmanimByDate = Record<string, Record<string, ChabadEmbedZman>>;

export type ResolvedCandleLighting = {
  time: Date;
  /**
   * The @hebcal/core event, when Hebcal produced the value — the widget
   * labels off it (`formatEventLabel`, which distinguishes "Candle lighting"
   * from a Yom Tov's own name). `null` when the value came from Chabad's
   * cache, which carries no such label; the widget falls back to a generic
   * one there.
   */
  event: CandleLightingEvent | null;
  /**
   * True only when the resolved provider was Chabad and its cache had
   * nothing for the needed date, so this value is Hebcal's own computation
   * standing in. plan.md §5c: "surface a subtle 'showing calculated times'
   * indicator rather than failing silently, since a wrong zman is worse
   * than a flagged one."
   *
   * Always false for hebcal and manual — those *are* the calculated path,
   * and nothing has fallen back; flagging them would make the indicator
   * meaningless.
   */
  fellBackToHebcal: boolean;
  /**
   * Which source the displayed value actually came from.
   *
   * This exists for the attribution, not for the fallback flag: Chabad.org
   * publishes their candle-lighting embed on the condition that an
   * application using it credits them (lib/zmanim/chabad-embed.ts), so the
   * widget has to know when the time on screen is theirs. It is derivable
   * from `provider` and `fellBackToHebcal` together, and stated outright
   * anyway — a renderer reconstructing a licence condition from two other
   * fields is how the credit goes missing in a later refactor.
   *
   * `"hebcal"` covers manual too: that path is Hebcal's computation with a
   * different candle-lighting offset, and nobody needs crediting for it.
   */
  source: "chabad" | "hebcal";
};

/**
 * `instant`'s calendar date in `timeZone` as `YYYY-MM-DD` — the key
 * `ChabadZmanimByDate` and `zmanim_cache.date` are both keyed by.
 *
 * Built from `formatToParts` rather than trusting `format()`'s output shape,
 * the same way lib/hebrew/civil-day.ts's `civilDateInZone` does it: en-CA
 * happens to render ISO-ish today, but the part types are the contract and
 * the joined string isn't.
 */
function isoDateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The next candle lighting to show, and where it came from.
 *
 * Hebcal is computed FIRST, for every provider including Chabad, because
 * it's what establishes *which date matters*. A Chabad cache dict can hold
 * plenty of dates and still be missing the one about to happen (a cache
 * miss, a cron that hasn't run, or a real no-match like the second night of
 * a two-day Yom Tov, which the embed phrases as "Light Holiday Candles
 * after" and the reader deliberately excludes — see
 * test/fixtures/chabad-embed-33701-4w.js's 9/12 entry). "Is the
 * dict empty" cannot tell those apart from a healthy cache; "does the dict
 * have the date Hebcal says is next" can, and answers all three the same
 * way.
 *
 * That comparison is by LOCAL CALENDAR DATE, never by instant. Providers
 * legitimately disagree by a minute or two on the same date — that
 * disagreement is the entire reason plan.md §5c supports more than one
 * provider — so an instant comparison would treat a perfectly good Chabad
 * value as a miss and throw it away for a computed one, which is exactly
 * backwards.
 *
 * Computing Hebcal in Chabad mode is not a new class of work: it is the
 * same computation hebcal mode already runs on every tick, now run in one
 * more mode, and the caller memoizes it per second.
 */
export function resolveCandleLighting(input: {
  now: Date;
  provider: "hebcal" | "chabad" | "myzmanim" | "manual";
  location: BoardLocation;
  chabadZmanim: ChabadZmanimByDate | null;
  /** candle-lighting/manifest.ts's Manual "minutes before sunset"; read
   *  only when `provider` is `"manual"`, ignored otherwise. */
  manualMinutesBeforeSunset?: number;
}): ResolvedCandleLighting | null {
  const { now, provider, location, chabadZmanim, manualMinutesBeforeSunset } = input;

  const hebcalEvent = upcomingCandleLighting(
    now,
    location,
    provider === "manual" ? manualMinutesBeforeSunset : undefined,
  );

  if (provider !== "chabad") {
    // No fallback concept here at all — hebcal and manual are the computed
    // path, and `myzmanim` has no adapter yet, so it resolves the same way
    // it did before this function existed (plan.md §5c scope: "MyZmanim
    // gets nothing").
    return (
      hebcalEvent && {
        time: hebcalEvent.eventTime,
        event: hebcalEvent,
        fellBackToHebcal: false,
        source: "hebcal",
      }
    );
  }

  // Nine days always contains a Friday (candle-times.ts's SEARCH_WINDOW_DAYS),
  // so on any real location this is non-null and the `null` below is
  // unreachable in practice — it exists because the type says it can be,
  // not as a case to design for.
  if (!hebcalEvent) return null;

  const neededDate = isoDateInZone(hebcalEvent.eventTime, location.timeZone);
  const cached = chabadZmanim?.[neededDate]?.candle_lighting;

  if (cached) {
    return { time: new Date(cached.iso), event: null, fellBackToHebcal: false, source: "chabad" };
  }

  return { time: hebcalEvent.eventTime, event: hebcalEvent, fellBackToHebcal: true, source: "hebcal" };
}
