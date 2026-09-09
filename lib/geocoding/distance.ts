/*
 * Great-circle distance, for the one thing this product measures: how far
 * apart two places a gabbai has told us about actually are.
 *
 * Separate from locationiq.ts, and deliberately not `server-only`: it needs
 * no key and no network, so a test can import it directly and a client
 * component could show a distance without a round trip.
 */

const EARTH_RADIUS_MILES = 3958.8;

export type Point = { latitude: number; longitude: number };

/**
 * Haversine. Accurate to a fraction of a percent at any distance, which is
 * far better than this needs: the only caller compares against a ~30-mile
 * threshold to catch a Brooklyn/Florida mix-up, where being off by a mile
 * changes nothing.
 */
export function milesBetween(a: Point, b: Point): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rounded the way the warning that uses it reads it out: "about 1,100
 *  miles apart", never "1,097.3184". */
export function describeMiles(miles: number): string {
  if (miles < 10) return `about ${miles.toFixed(1)} miles`;
  return `about ${Math.round(miles).toLocaleString("en-US")} miles`;
}
