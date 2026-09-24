import "server-only";
import tzlookup from "@photostructure/tz-lookup";

/*
 * The shul's timezone, from where the shul is.
 *
 * A gabbai shouldn't have to pick "America/New_York" from a list of four
 * hundred: the address already says it. This reads it off the coordinates
 * with an offline map of the world's zone boundaries (@photostructure/
 * tz-lookup) — no request, no quota, and it works for coordinates typed by
 * hand as well as for a looked-up address.
 *
 * Near a zone boundary the offline map is coarse (a few kilometres), which is
 * fine for a building; a shul is not going to sit on the line between two
 * zones. Null only for coordinates that aren't on Earth.
 */
export function timezoneAt(latitude: number, longitude: number): string | null {
  try {
    const zone = tzlookup(latitude, longitude);
    // The map can name a zone this runtime's Intl doesn't know (an old ICU);
    // a zone nothing can format a time in is worse than none.
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}
