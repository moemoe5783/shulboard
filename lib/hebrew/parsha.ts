import { HDate, ParshaEvent, Sedra } from "@hebcal/core";
import type { BoardLocation } from "@/lib/board-location";
import { civilDateInZone } from "./civil-day.ts";
import { toHebcalLocation } from "./hebcal-location.ts";

/**
 * This week's parsha, for any day of the week — `Sedra.lookup()` returns the
 * reading for "the first Saturday on or after" the given date, which is
 * exactly "this week's parsha" colloquially: the upcoming reading Sunday
 * through Friday, and that Shabbos's own reading on Shabbos itself. Israel
 * and the Diaspora read a different sedra in a handful of years, which is why
 * this needs a location the same way the calendar-driven widgets do, not
 * because a parsha has a candle-lighting time.
 */
export function currentParsha(now: Date, location: BoardLocation): ParshaEvent {
  const civilDate = civilDateInZone(now, location.timeZone);
  const hebcalLocation = toHebcalLocation(location);
  const hdate = new HDate(civilDate);
  const sedra = new Sedra(hdate.getFullYear(), hebcalLocation.getIsrael());
  return new ParshaEvent(sedra.lookup(hdate));
}
