import { CandleLightingEvent, HavdalahEvent, HebrewCalendar, type Event } from "@hebcal/core";
import { z } from "zod";
import type { BoardLocation } from "@/lib/board-location";
import { civilDateInZone } from "./civil-day.ts";
import { toHebcalLocation } from "./hebcal-location.ts";

/*
 * The next candle lighting — Candle Lighting's own countdown widget — and
 * the next Havdalah, computed the same way but not currently rendered by
 * anything (see the note above havdalahShitahSchema below for why this is
 * kept rather than deleted).
 *
 * Generated through `HebrewCalendar.calendar({candlelighting: true, ...})`
 * rather than a hand-rolled `sunsetOffset(-18)`: the library already knows
 * the halachic edge cases that a plain "18 minutes before Friday sundown"
 * formula gets wrong — a two-day Yom Tov that abuts Shabbos lights the second
 * night's candles from an existing flame only after Shabbos itself ends
 * (nightfall, not sundown), Israel and Jerusalem use different candle-
 * lighting minutes than the Diaspora, and so on. Verified empirically against
 * a Rosh Hashana that fell on Shabbos before relying on it — see
 * scripts/test-hebrew.ts.
 */

/**
 * NOT WIRED TO ANY WIDGET RIGHT NOW — this is not dead code, it's early.
 * havdalahShitahSchema/havdalahCustomMinutesSchema below, havdalahOffsetFor(),
 * and upcomingHavdalah()'s own shitah/customMinutes parameters were built for
 * a standalone Havdalah widget. That widget shipped, got exactly this shitah
 * override, and was then removed: Havdalah is being folded into the Zmanim
 * provider layer (plan.md §5c) rather than staying its own widget. Kept
 * because it's already the right shape for that layer's Hebcal provider
 * adapter — mapping a canonical zman id to the `{havdalahDeg}`/
 * `{havdalahMins}` shape `HebrewCalendar.calendar()` expects is exactly what
 * a Hebcal adapter has to do. When that work starts, call this rather than
 * re-deriving it; plan.md §5c points back here.
 *
 * Which definition of nightfall ends Havdalah — plan.md §5c's canonical zman
 * vocabulary (`tzeis_3_stars`, `tzeis_72`) reused for two of these four
 * options rather than inventing separate names, so this lines up with the
 * rest of the zmanim provider work instead of needing to be reconciled with
 * it later. The other two aren't a §5c id yet: `tzeis_medium_stars` is named
 * to match that list's own pattern (a plain name alongside a degree-named
 * zman like `alos_16.1deg`) rather than left for that work to invent
 * separately, and `custom` is this schema's own spelling of §5c's "Manual —
 * per-zman override or fixed offset" provider.
 *
 * `tzeis_3_stars` (8.5°) is @hebcal/core's own default — see
 * `Zmanim.tzeit`'s `angle = 8.5` in `node_modules/@hebcal/core/dist/esm/
 * zmanim.js` — and it's what the removed Havdalah widget silently used
 * before this type existed. It stays the default here: verified against
 * hebcal.com's own published Havdalah time for Crown Heights
 * (scripts/test-hebrew.ts's own history), and it's also the methodology
 * chabad.org's own zmanim engine documents. It is NOT necessarily what a
 * given Chabad shul's actual practice is — many, Crown Heights included,
 * treat Havdalah later than this astronomical minimum in practice, which is
 * the whole reason the other three options exist.
 */
export const havdalahShitahSchema = z
  .enum(["tzeis_3_stars", "tzeis_medium_stars", "tzeis_72", "custom"])
  .default("tzeis_3_stars");
export type HavdalahShitah = z.infer<typeof havdalahShitahSchema>;

/** Read only when shitah is "custom"; ignored otherwise — same shape as
 *  candle-lighting/manifest.ts's own size/sizingMode pair. 50 is a common
 *  round number between medium-stars (~42) and Rabbeinu Tam (72), not a
 *  halachic default of any kind. */
export const havdalahCustomMinutesSchema = z.number().min(1).max(180).default(50);

/** @hebcal/core's own named constant for "3 medium stars" — see
 *  `TZEIT_3MEDIUM_STARS` in `node_modules/@hebcal/core/dist/esm/candles.js`,
 *  which is what that library uses as its own default for minor-fast endings
 *  in the Diaspora. Duplicated here as a literal rather than imported: it's
 *  not exported from the package, only used internally. */
const TZEIS_MEDIUM_STARS_DEG = 7.0833333;
const RABBEINU_TAM_MINS = 72;

type HavdalahOffset = { havdalahDeg: number } | { havdalahMins: number };

function havdalahOffsetFor(shitah: HavdalahShitah, customMinutes: number): HavdalahOffset {
  switch (shitah) {
    case "tzeis_3_stars":
      return { havdalahDeg: 8.5 };
    case "tzeis_medium_stars":
      return { havdalahDeg: TZEIS_MEDIUM_STARS_DEG };
    case "tzeis_72":
      return { havdalahMins: RABBEINU_TAM_MINS };
    case "custom":
      return { havdalahMins: customMinutes };
  }
}

/** Nine days always contains at least one ordinary Friday, so this never
 *  comes back empty on a board that has any location at all — even starting
 *  from a Shabbos morning with no chag in sight. */
const SEARCH_WINDOW_DAYS = 9;

function upcomingEvents(
  now: Date,
  location: BoardLocation,
  havdalah?: HavdalahOffset,
  candleLightingMins?: number,
): Event[] {
  const start = civilDateInZone(now, location.timeZone);
  const end = new Date(start);
  end.setDate(end.getDate() + SEARCH_WINDOW_DAYS);

  const hebcalLocation = toHebcalLocation(location);
  return HebrewCalendar.calendar({
    start,
    end,
    location: hebcalLocation,
    candlelighting: true,
    il: hebcalLocation.getIsrael(),
    ...havdalah,
    // undefined, not omitted, when unset: @hebcal/core's own default (18
    // minutes Diaspora, more in Israel — lib/hebrew/hebcal-location.ts's own
    // comment) applies exactly as it did before this parameter existed.
    ...(candleLightingMins !== undefined ? { candleLightingMins } : {}),
  });
}

function earliestAfter<T extends Event & { eventTime: Date }>(events: Event[], now: Date, isMatch: (ev: Event) => ev is T): T | null {
  const matches = events
    .filter(isMatch)
    .filter((ev) => ev.eventTime.getTime() > now.getTime())
    .sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
  return matches[0] ?? null;
}

const isCandleLighting = (ev: Event): ev is CandleLightingEvent => ev instanceof CandleLightingEvent;
const isHavdalah = (ev: Event): ev is HavdalahEvent => ev instanceof HavdalahEvent;

/**
 * `candleLightingMins` is candle-lighting/manifest.ts's own Manual provider
 * option ("minutes before sunset") — omitted (the only way every existing
 * caller, including every fixed-date value scripts/test-hebrew.ts already
 * checks, still calls this) falls through to @hebcal/core's own default.
 */
export function upcomingCandleLighting(
  now: Date,
  location: BoardLocation,
  candleLightingMins?: number,
): CandleLightingEvent | null {
  return earliestAfter(upcomingEvents(now, location, undefined, candleLightingMins), now, isCandleLighting);
}

/**
 * Every candle lighting in the next `days`, in order — the plural of the
 * function above, for candle-lighting's "all upcoming in the week" display
 * mode.
 *
 * A week routinely holds more than one: Erev Yom Kippur falling on a
 * Sunday sits in the same week as the Friday before it, and a two-day Yom
 * Tov abutting Shabbos produces a run of them. The single-value function
 * above cannot express that, and computing it by calling that function
 * repeatedly with a shifting `now` would rebuild @hebcal/core's calendar
 * once per entry.
 *
 * `days` is clamped to SEARCH_WINDOW_DAYS: nine days is what
 * `upcomingEvents` actually generates, so asking for more would silently
 * return a short list rather than the window requested.
 */
export function upcomingCandleLightings(
  now: Date,
  location: BoardLocation,
  days: number,
  candleLightingMins?: number,
): CandleLightingEvent[] {
  const horizon = now.getTime() + Math.min(days, SEARCH_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  return upcomingEvents(now, location, undefined, candleLightingMins)
    .filter(isCandleLighting)
    .filter((ev) => ev.eventTime.getTime() > now.getTime() && ev.eventTime.getTime() <= horizon)
    .sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
}

// Unused today — see the NOT WIRED TO ANY WIDGET note above
// havdalahShitahSchema. Defaults match that schema's and
// havdalahCustomMinutesSchema's own `.default()`s, so a future caller that
// doesn't have a widget config handy yet (a migration path, a quick script)
// gets the same behavior a bare `upcomingHavdalah(now, location)` always has.
export function upcomingHavdalah(
  now: Date,
  location: BoardLocation,
  shitah: HavdalahShitah = "tzeis_3_stars",
  customMinutes = 50,
): HavdalahEvent | null {
  const offset = havdalahOffsetFor(shitah, customMinutes);
  return earliestAfter(upcomingEvents(now, location, offset), now, isHavdalah);
}
