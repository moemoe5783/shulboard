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
 * Candle lighting, resolved: which dates need one, and what Chabad
 * published for each — plan.md §5c.
 *
 * THERE IS NO FALLBACK LEG ANY MORE. §5c's chain used to read "requested
 * provider → cache → Hebcal (client-side, always works)", and the Hebcal
 * leg is gone: Chabad.org is the only source (lib/zmanim/provider.ts), and
 * a date it has no value for shows the unavailable state rather than a
 * computed stand-in. Nothing here computes a time.
 *
 * @hebcal/core IS STILL IMPORTED, and that is not a leftover. It answers a
 * different question: WHICH dates are candle-lighting dates, and what a
 * Yom Tov's own name is. Chabad's cache can say what time to light on a
 * given date, but it cannot say that the next one is nine days out, or
 * or that the second night of a two-day Yom Tov is one at all. The line
 * is: hebcal is the calendar, Chabad is the clock. A hebcal event reaching
 * a board is always a LABEL, never a time.
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
  /** Chabad's own instant for this date. Never computed. */
  time: Date;
  /**
   * The @hebcal/core event for the DATE this falls on. Always present now,
   * because a hebcal event is what identified the date in the first place,
   * and it contributes nothing to `time`.
   *
   * The widget labels off it — but what that yields is a localised "Candle
   * lighting", not the occasion: `renderBrief` returns the same string for
   * Erev Yom Kippur as for an ordinary Friday, since the Yom Tov name is on
   * `linkedEvent`. Carried anyway, because it is what says the date came
   * from the calendar and it is where a future change would read the
   * occasion from.
   */
  event: CandleLightingEvent;
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
  /** At least one time Chabad published. */
  | { status: "ok"; entries: ResolvedCandleLighting[] }
  /**
   * Chabad has nothing for the date(s) in question, so there is nothing to
   * show. No computed substitute exists any more.
   *
   * A DISTINCT STATUS, not an empty list, because the widget has to say
   * something specific about it. This is not "offline" and must never be
   * presented as one: the display route boots from its last-known-good
   * bundle (plan.md §3c) and keeps working without a network, so a screen
   * showing this is almost certainly online and simply has no data for
   * that date — past the end of the warmed window (92 days,
   * lib/zmanim/warm.ts), or a date the warm missed. Telling a gabbai to
   * check the network would send them after the wrong problem entirely.
   *
   * THIS IS NOW A COMMON STATE, not a corner. It used to require a shul to
   * have deliberately turned off "Calculate missing times"; with the
   * computed path gone it is what every uncached date shows. The wording
   * has to read as intentional to a room, which is why it is one calm
   * factual line and not a diagnostic.
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
 * A date Chabad has not published is dropped, and a resolution with
 * nothing left comes back `unavailable`. There is no switch: the computed
 * substitute this used to offer is gone, so "Chabad's value or nothing" is
 * the only behaviour rather than one of two.
 */
export function resolveCandleLightings(input: {
  now: Date;
  location: BoardLocation;
  chabadZmanim: ChabadZmanimByDate | null;
  /** How many days ahead to collect. 1 for "next only" — the horizon still
   *  has to be wide enough to find the next one, so the caller passes the
   *  week either way and takes the first entry. */
  days: number;
}): CandleLightingResolution {
  const { now, location, chabadZmanim, days } = input;

  // The CALENDAR question: which dates in this window want a candle
  // lighting at all. @hebcal/core answers it from lat/long and the Hebrew
  // calendar; Chabad's cache cannot, since a date with no row is
  // indistinguishable from an ordinary Tuesday.
  const dates = upcomingCandleLightings(now, location, days);

  const entries: ResolvedCandleLighting[] = [];
  for (const event of dates) {
    // By LOCAL CALENDAR DATE, never by instant — see the note on
    // resolveCandleLighting below, which this shares.
    const cached = chabadZmanim?.[isoDateInZone(event.eventTime, location.timeZone)]?.candle_lighting;
    // Chabad's value or nothing. A date it has not published is dropped;
    // a resolution with nothing left comes back `unavailable`.
    if (cached && isClockZman(cached)) entries.push({ time: new Date(cached.iso), event });
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
  location: BoardLocation;
  chabadZmanim: ChabadZmanimByDate | null;
}): ResolvedCandleLighting | null {
  const { now, location, chabadZmanim } = input;

  const hebcalEvent = upcomingCandleLighting(now, location);

  // Nine days always contains a Friday (candle-times.ts's SEARCH_WINDOW_DAYS),
  // so on any real location this is non-null and the `null` below is
  // unreachable in practice — it exists because the type says it can be,
  // not as a case to design for.
  if (!hebcalEvent) return null;

  const neededDate = isoDateInZone(hebcalEvent.eventTime, location.timeZone);
  const cached = chabadZmanim?.[neededDate]?.candle_lighting;

  // Chabad's value or nothing at all. `null` here and `null` for a missing
  // hebcal event are the same answer to the widget — no time to show —
  // which is why this returns one shape rather than distinguishing them.
  if (cached && isClockZman(cached)) return { time: new Date(cached.iso), event: hebcalEvent };
  return null;
}
