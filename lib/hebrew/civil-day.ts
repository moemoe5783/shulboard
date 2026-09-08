import { HDate } from "@hebcal/core";
import type { BoardLocation } from "@/lib/board-location";
import { sunsetOn } from "./sunset.ts";

/*
 * "Today," for a screen that isn't necessarily in the same timezone as
 * whoever is looking at this code run — the editor previews from the org's
 * location (BoardEditor.tsx), which is very often a different city from
 * wherever the browser rendering the preview happens to sit.
 */

/**
 * A `Date` whose LOCAL year/month/day (the fields `HDate`'s constructor
 * reads) match `instant`'s calendar date in `timeZone`, regardless of what
 * zone this code is actually running in.
 *
 * `HDate(Date)` reads a Date's fields as reported by the JS engine's own
 * locale/zone — there is no way to hand it a Date plus a separate timezone.
 * So this asks `Intl.DateTimeFormat` what the calendar date is in the
 * *target* zone, then builds a plain local Date carrying exactly those
 * numbers, which is what makes the same board show the same Hebrew date to
 * an editor open in Los Angeles and a screen hanging in Crown Heights.
 */
export function civilDateInZone(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(get("year"), get("month") - 1, get("day"));
}

/**
 * The Hebrew date a board should show right now — docs/sizing... no, plan.md
 * §5's "sunset rollover toggle (does the Hebrew date flip at sunset or
 * midnight)".
 *
 * `sunsetRollover: false` is just `civilDateInZone` handed to `HDate`: the
 * Hebrew date changes at local midnight, same moment the Gregorian one does.
 * `true` additionally checks today's sunset in `location` (lib/hebrew/zmanim
 * .ts) and, once `now` has passed it, uses tomorrow's civil date instead —
 * halachically correct (a Jewish day begins at nightfall) at the cost of a
 * few widgets ticking over at a different moment than the wall clock.
 */
export function effectiveHebrewDate(
  now: Date,
  location: BoardLocation,
  sunsetRollover: boolean,
): HDate {
  const today = civilDateInZone(now, location.timeZone);
  if (!sunsetRollover) return new HDate(today);

  const sunset = sunsetOn(today, location);
  if (sunset !== null && now.getTime() >= sunset.getTime()) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return new HDate(tomorrow);
  }
  return new HDate(today);
}
