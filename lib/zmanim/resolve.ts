import type { CandleLightingEvent } from "@hebcal/core";
import type { BoardLocation } from "@/lib/board-location";
// Relative and extensioned, the way lib/hebrew's own modules import each
// other (candle-times.ts's `./civil-day.ts`): this is the one non-type
// import here, and it has to resolve under plain `node` for
// scripts/test-zmanim-fallback.ts, which has no bundler to read tsconfig's
// `@/` alias.
import { upcomingCandleLighting, upcomingCandleLightings } from "../hebrew/candle-times.ts";
// Extensioned for the same reason, and a VALUE import now, not a type:
// `isClockZman` narrows `zmanim_cache.times`' union at runtime. Importing
// it from zman.ts rather than from either Chabad reader is what keeps this
// module client-safe — zman.ts is a static table with no `server-only`,
// no fetch and no key.
import { isClockZman, type ChabadZman } from "./zman.ts";

/*
 * plan.md §5c's fallback chain — "requested provider → cache → Hebcal
 * (client-side, always works) → last known good" — for the one zman that
 * has a provider today, `candle_lighting`.
 *
 * Client-safe, no fetch, no server-only import — the value shapes and the
 * one narrowing helper come from zman.ts, which is a static table.
 * Nothing here parses a provider response: the Chabad side of this reads
 * an already-parsed dict, so the adapter's own parsing logic is not
 * involved in, and does not change for, any of the fallback behavior
 * below.
 *
 * candle-lighting/Renderer.tsx is the only caller, and it calls this for
 * every provider rather than branching itself — the whole point is that the
 * decision of which source produced the value, and whether that was a
 * fallback, is made in one pure function that a test can drive directly.
 */

/**
 * `zmanim_cache.times` as the display and the editor hand it over — ISO
 * date -> zman id -> value.
 *
 * The value is `ChabadZman`, a union: most ids carry a clock time, and
 * `chabad:ShaahZmanit` carries a duration instead (zman.ts). Everything
 * below reads `candle_lighting`, which is always a clock time, but it
 * still narrows with `isClockZman` rather than asserting — a hand-written
 * cache row or a future provider that files a duration under an
 * unexpected id would otherwise become `new Date(undefined)`, i.e. an
 * Invalid Date rendered on a shul's board.
 */
export type ChabadZmanimByDate = Record<string, Record<string, ChabadZman>>;

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

/** How far "all upcoming in the week" looks. Seven days, which routinely
 *  holds more than one entry — Erev Yom Kippur on a Sunday shares a week
 *  with the Friday before it. */
export const WEEK_DAYS = 7;

export type CandleLightingResolution =
  /** At least one time to show. Every entry carries its own
   *  `fellBackToHebcal`, because in a week that straddles the end of
   *  Chabad's cached window some entries are fetched and some are not. */
  | { status: "ok"; entries: ResolvedCandleLighting[] }
  /**
   * The resolved provider has nothing for the date(s) in question and the
   * widget has been told not to compute a substitute
   * (`fallbackToCalculated: false`).
   *
   * A DISTINCT STATUS, not an empty list, because the widget has to say
   * something specific about it. This is not "offline" and must never be
   * presented as one: the display route boots from its last-known-good
   * bundle (plan.md §3c) and keeps working without a network, so a screen
   * showing this is almost certainly online and simply has no data for
   * that date — often because the date is past the end of Chabad's warmed
   * window (92 days, lib/zmanim/warm.ts). Telling a gabbai to check the
   * network would send them after the wrong problem entirely.
   */
  | { status: "unavailable" };

/**
 * Every candle lighting the widget should show, and where each came from.
 *
 * One function for all three of candle-lighting's display modes — next
 * only, all upcoming in the week, rotate — because they differ in how many
 * of this list they render, not in how the list is resolved. The Renderer
 * slices; nothing here knows which mode is on.
 *
 * `fallbackToCalculated` is the per-widget choice from item 2: with it on
 * (the default, and the behaviour before it existed) a date Chabad has no
 * value for is computed by Hebcal and flagged. With it off, that date is
 * dropped instead, and a resolution with nothing left comes back
 * `unavailable` — some shuls would rather show nothing than a time that
 * isn't from the source they picked.
 */
export function resolveCandleLightings(input: {
  now: Date;
  provider: "hebcal" | "chabad" | "myzmanim" | "manual";
  location: BoardLocation;
  chabadZmanim: ChabadZmanimByDate | null;
  manualMinutesBeforeSunset?: number;
  /** How many days ahead to collect. 1 for "next only" — the horizon still
   *  has to be wide enough to find the next one, so the caller passes the
   *  week either way and takes the first entry. */
  days: number;
  fallbackToCalculated: boolean;
}): CandleLightingResolution {
  const { now, provider, location, chabadZmanim, manualMinutesBeforeSunset, days, fallbackToCalculated } = input;

  const hebcalEvents = upcomingCandleLightings(
    now,
    location,
    days,
    provider === "manual" ? manualMinutesBeforeSunset : undefined,
  );

  if (provider !== "chabad") {
    // Hebcal and manual ARE the computed path, so `fallbackToCalculated`
    // has nothing to say about them — there is no provider value to be
    // missing. Turning it off must not blank a Hebcal widget.
    return {
      status: "ok",
      entries: hebcalEvents.map((event) => ({ time: event.eventTime, event, fellBackToHebcal: false })),
    };
  }

  const entries: ResolvedCandleLighting[] = [];
  for (const event of hebcalEvents) {
    // By LOCAL CALENDAR DATE, never by instant — see the note on
    // resolveCandleLighting below, which this shares.
    const cached = chabadZmanim?.[isoDateInZone(event.eventTime, location.timeZone)]?.candle_lighting;
    if (cached && isClockZman(cached)) {
      entries.push({ time: new Date(cached.iso), event: null, fellBackToHebcal: false });
    } else if (fallbackToCalculated) {
      entries.push({ time: event.eventTime, event, fellBackToHebcal: true });
    }
    // else: dropped on purpose. The shul asked for its source or nothing.
  }

  if (entries.length === 0) return { status: "unavailable" };
  return { status: "ok", entries };
}

/**
 * The next candle lighting to show, and where it came from.
 *
 * Hebcal is computed FIRST, for every provider including Chabad, because
 * it's what establishes *which date matters*. A Chabad cache dict can hold
 * plenty of dates and still be missing the one about to happen (a cache
 * miss, a cron that hasn't run, or a real no-match like the second night of
 * a two-day Yom Tov, which Chabad files as a `ShabbatEndTime` carrying a
 * `LightCandlesAfter` footnote rather than as a `CandleLighting`, so it
 * never lands under `candle_lighting` at all — see
 * test/fixtures/chabad-zmanim-33701-92day.json's 9/12 entry). "Is the
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
    return hebcalEvent && { time: hebcalEvent.eventTime, event: hebcalEvent, fellBackToHebcal: false };
  }

  // Nine days always contains a Friday (candle-times.ts's SEARCH_WINDOW_DAYS),
  // so on any real location this is non-null and the `null` below is
  // unreachable in practice — it exists because the type says it can be,
  // not as a case to design for.
  if (!hebcalEvent) return null;

  const neededDate = isoDateInZone(hebcalEvent.eventTime, location.timeZone);
  const cached = chabadZmanim?.[neededDate]?.candle_lighting;

  if (cached && isClockZman(cached)) {
    return { time: new Date(cached.iso), event: null, fellBackToHebcal: false };
  }

  return { time: hebcalEvent.eventTime, event: hebcalEvent, fellBackToHebcal: true };
}
