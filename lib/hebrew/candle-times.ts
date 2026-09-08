import { CandleLightingEvent, HavdalahEvent, HebrewCalendar, type Event } from "@hebcal/core";
import { z } from "zod";
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

/**
 * Which definition of nightfall ends Havdalah — plan.md §5c's canonical zman
 * vocabulary (`tzeis_3_stars`, `tzeis_72`) reused for two of these four
 * options rather than inventing separate names, so this lines up with the
 * zmanim provider work when it lands instead of needing to be reconciled with
 * it later. The other two aren't a §5c id yet: `tzeis_medium_stars` is named
 * to match that list's own pattern (a plain name alongside a degree-named
 * zman like `alos_16.1deg`) rather than left for the zmanim work to invent
 * separately, and `custom` is this widget's own spelling of §5c's "Manual —
 * per-zman override or fixed offset" provider.
 *
 * `tzeis_3_stars` (8.5°) is @hebcal/core's own default — see
 * `Zmanim.tzeit`'s `angle = 8.5` in `node_modules/@hebcal/core/dist/esm/
 * zmanim.js` — and it's what this widget silently used before this type
 * existed. It stays the default here: verified against hebcal.com's own
 * published Havdalah time for Crown Heights (scripts/test-hebrew.ts), and
 * it's also the methodology chabad.org's own zmanim engine documents. It is
 * NOT necessarily what a given Chabad shul's actual practice is — many,
 * Crown Heights included, treat Havdalah later than this astronomical
 * minimum in practice, which is the whole reason the other three options
 * exist.
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

function upcomingEvents(now: Date, location: BoardLocation, havdalah?: HavdalahOffset): Event[] {
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

// Defaults match havdalahShitahSchema/havdalahCustomMinutesSchema's own
// `.default()`s, for the callers below that don't carry a widget config —
// scripts/test-hebrew.ts's pre-existing calls among them.
export function upcomingHavdalah(
  now: Date,
  location: BoardLocation,
  shitah: HavdalahShitah = "tzeis_3_stars",
  customMinutes = 50,
): HavdalahEvent | null {
  const offset = havdalahOffsetFor(shitah, customMinutes);
  return earliestAfter(upcomingEvents(now, location, offset), now, isHavdalah);
}
