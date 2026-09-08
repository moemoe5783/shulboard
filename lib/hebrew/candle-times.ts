import { CandleLightingEvent, HavdalahEvent, HebrewCalendar, type Event } from "@hebcal/core";
import type { BoardLocation } from "@/lib/board-location";
import { civilDateInZone } from "./civil-day.ts";
import { toHebcalLocation } from "./hebcal-location.ts";

/*
 * The next candle lighting and the next Havdalah — for the widgets that
 * count down to them.
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

/** Nine days always contains at least one ordinary Friday, so this never
 *  comes back empty on a board that has any location at all — even starting
 *  from a Shabbos morning with no chag in sight. */
const SEARCH_WINDOW_DAYS = 9;

function upcomingEvents(now: Date, location: BoardLocation): Event[] {
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

export function upcomingCandleLighting(now: Date, location: BoardLocation): CandleLightingEvent | null {
  return earliestAfter(upcomingEvents(now, location), now, isCandleLighting);
}

export function upcomingHavdalah(now: Date, location: BoardLocation): HavdalahEvent | null {
  return earliestAfter(upcomingEvents(now, location), now, isHavdalah);
}
