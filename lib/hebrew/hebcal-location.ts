import { Location } from "@hebcal/core";
import type { BoardLocation } from "@/lib/board-location";

/*
 * A board's location, as @hebcal/core wants it.
 *
 * `Location` also carries an Israel/Diaspora flag, which changes candle
 * lighting minutes (18 in the Diaspora, 20 in Israel — more in Jerusalem,
 * Haifa and Zikhron Ya'akov) and the holiday/Torah-reading schedule. There is
 * no org-level "in Israel" setting to read (plan.md doesn't ask for one), so
 * this derives it from the longitude/latitude box the State of Israel sits
 * in — approximate, but the actual decision (Diaspora candle-lighting minutes
 * vs Israeli ones) only changes at that country's own borders, which this is
 * accurate enough to place a shul on the correct side of.
 */
const ISRAEL_BOUNDS = { minLat: 29.4, maxLat: 33.4, minLng: 34.2, maxLng: 35.9 };

function isInIsrael(latitude: number, longitude: number): boolean {
  return (
    latitude >= ISRAEL_BOUNDS.minLat &&
    latitude <= ISRAEL_BOUNDS.maxLat &&
    longitude >= ISRAEL_BOUNDS.minLng &&
    longitude <= ISRAEL_BOUNDS.maxLng
  );
}

export function toHebcalLocation(location: BoardLocation): Location {
  return new Location(
    location.latitude,
    location.longitude,
    isInIsrael(location.latitude, location.longitude),
    location.timeZone,
  );
}
