import { Zmanim } from "@hebcal/core";
import type { BoardLocation } from "@/lib/board-location";
import { toHebcalLocation } from "./hebcal-location.ts";

/*
 * Sunset, for the sunset-rollover Hebrew date (civil-day.ts).
 *
 * NOT the Zmanim widget (plan.md §5c) — that needs the Hebcal/Chabad.org/
 * MyZmanim provider layer, a settings UI, and a cache table, and is explicitly
 * a separate piece of work. This is one number, always computed the same way
 * (Hebcal's own NOAA solar calculator, `@hebcal/core`'s `Zmanim` class), used
 * only to decide whether "today" has already rolled into "tonight" for the
 * widgets in this batch that need that answer.
 */

/** `null` if the location is invalid enough that the underlying calculation
 *  cannot produce a date — Zmanim throws rather than returning one at the
 *  poles, where "sunset" stops being well-defined for parts of the year. */
export function sunsetOn(civilDate: Date, location: BoardLocation): Date | null {
  try {
    const zmanim = new Zmanim(toHebcalLocation(location), civilDate, false);
    return zmanim.sunset();
  } catch {
    return null;
  }
}
