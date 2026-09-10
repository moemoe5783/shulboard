import "server-only";

/*
 * Address and ZIP lookup, via LocationIQ.
 *
 * WHY A SERVICE AT ALL: latitude and longitude as raw number fields don't
 * survive real users. A gabbai doesn't know his shul's coordinates, and a
 * wrong entry produces candle lighting that is quietly a few minutes off
 * with nothing on the screen to indicate it. This module is what lets the
 * settings form resolve a place the gabbai can actually recognise and check
 * before anything is saved.
 *
 * WHY LOCATIONIQ: it geocodes free-text addresses and US ZIPs, has a free
 * tier that permits commercial use, needs one key and no billing account,
 * and its response is Nominatim-compatible, so the shape below is the
 * long-stable OpenStreetMap one rather than a bespoke contract.
 * Free tier as documented: 5,000 requests/day and 2 requests/second, with
 * commercial use allowed provided the application links back to LocationIQ
 * — which is why the settings form renders an attribution line next to
 * every result, not as decoration.
 *
 * At this product's scale a lookup happens when a shul is set up and
 * essentially never again, so the daily cap is not a constraint worth
 * engineering around; the 2/second one is why nothing here fans out
 * concurrent requests.
 *
 * WHY IT IS NEVER REQUIRED: every function here can fail — no key, a 500,
 * a rate limit, the service simply gone — and a shul must still be able to
 * enter coordinates by hand. So this returns a typed outcome and never
 * throws, and the form keeps manual latitude/longitude inputs that are not
 * gated behind any of it. `reason` distinguishes the three failures on
 * purpose: "unconfigured" is a deployment that has no GEOCODING_API_KEY,
 * "not-found" is a real answer (that place doesn't exist), and
 * "unavailable" is the service failing. They read differently to a gabbai
 * and they matter differently to whoever is debugging.
 *
 * RESPONSE SHAPE — DOCUMENTED, NOT CAPTURED. The parser below is written
 * against LocationIQ's documented Nominatim-compatible response
 * (docs.locationiq.com/docs/search-forward-geocoding): an array of objects
 * carrying `display_name`, `lat` and `lon`, where LAT AND LON ARE STRINGS,
 * not numbers. It has not been checked against a live response — this
 * project's sandbox can't reach the host. So `readPlace` validates rather
 * than trusts: it accepts a string or a number, requires a finite value in
 * range, and requires a non-empty display name, so an unexpected shape
 * comes back as a clean "unavailable" rather than as NaN coordinates
 * written to the orgs row. scripts/test-geocoding.ts exercises that.
 */

const SEARCH = "https://us1.locationiq.com/v1/search";
const REVERSE = "https://us1.locationiq.com/v1/reverse";

/** Long enough for a slow geocoder, short enough that a gabbai doesn't sit
 *  on a spinner wondering whether the button worked. */
const TIMEOUT_MS = 8000;

export type GeocodedPlace = {
  /** LocationIQ's own `display_name` — the human-readable line the form
   *  shows back for confirmation ("770 Eastern Parkway, Brooklyn, Kings
   *  County, New York, 11213, USA"). This is the whole point of the
   *  lookup: a gabbai can judge this, and cannot judge 40.669. */
  label: string;
  latitude: number;
  longitude: number;
  /**
   * The result's own postal code, read from LocationIQ's STRUCTURED
   * `address.postcode`. `geocodeAddress` sends `addressdetails=1`, which
   * is what makes the endpoint return an `address` object at all; the
   * other two functions here don't, and don't need to — the ZIP lookup
   * already knows its own postcode and the reverse lookup is only ever
   * asked for a place name.
   *
   * Deliberately not regexed out of `display_name`. The postcode is in
   * that string too ("... Pinellas County, Florida, 33701, USA"), but its
   * position varies by country and a five-digit run in it could equally be
   * a house number or a road name — parsing prose for a field the response
   * already gives you structured is how a Florida shul ends up with a ZIP
   * of 533.
   *
   * `null` for a result that carries no postcode: a country that doesn't
   * use them, or a coarse match like a city centroid. Callers must treat
   * that as "no new value", never as "clear the stored one".
   */
  postcode: string | null;
};

export type GeocodeOutcome =
  | { ok: true; place: GeocodedPlace }
  | { ok: false; reason: "unconfigured" | "not-found" | "unavailable"; message: string };

/** Whether this deployment can geocode at all. Exported so a page can tell
 *  a gabbai up front that lookup is unavailable and to use the coordinate
 *  fields, rather than offering a button that can only fail. */
export function isGeocodingConfigured(): boolean {
  return Boolean(process.env.GEOCODING_API_KEY);
}

function readPlace(candidate: unknown): GeocodedPlace | null {
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;

  const label = typeof record.display_name === "string" ? record.display_name.trim() : "";
  if (!label) return null;

  // Strings in the documented response; a number would also be fine and
  // anything else is a shape change this should refuse rather than coerce
  // (`Number(null)` is 0, which is a real coordinate off the coast of
  // Africa — exactly the kind of plausible-looking wrong answer this
  // whole task is about removing).
  const toCoordinate = (value: unknown): number | null => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const latitude = toCoordinate(record.lat);
  const longitude = toCoordinate(record.lon);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  // A missing `address` object is not a failure — `addressdetails=1` is
  // only sent on the forward search, and a coordinate is still a
  // coordinate without it.
  const address = record.address as Record<string, unknown> | undefined;
  const rawPostcode = address && typeof address.postcode === "string" ? address.postcode.trim() : "";

  return { label, latitude, longitude, postcode: rawPostcode || null };
}

/**
 * One request, one outcome. Handles the four ways this can go wrong
 * distinctly — no key, a transport failure or timeout, an HTTP error, and
 * a 200 whose body isn't the documented shape — because "the lookup didn't
 * work" is not an actionable thing to report to either a gabbai or a
 * developer.
 *
 * A 404 with LocationIQ's own `{"error": ...}` body is how it reports no
 * match, so that becomes "not-found" rather than "unavailable": nothing is
 * broken, the place just isn't there.
 */
async function request(url: URL, notFoundMessage: string): Promise<GeocodeOutcome> {
  const key = process.env.GEOCODING_API_KEY;
  if (!key) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "Address lookup isn't set up on this deployment. Enter the coordinates below by hand.",
    };
  }
  url.searchParams.set("key", key);
  url.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Deliberately not surfacing the cause: it's a DNS or TLS or abort
    // message that means nothing to a gabbai, and the actionable half of
    // this sentence is the same either way.
    return {
      ok: false,
      reason: "unavailable",
      message: "Address lookup didn't answer. Try again, or enter the coordinates below by hand.",
    };
  }

  if (response.status === 404) {
    return { ok: false, reason: "not-found", message: notFoundMessage };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: "unavailable",
      message: `Address lookup failed (${response.status}). Try again, or enter the coordinates below by hand.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "Address lookup returned something unreadable. Enter the coordinates below by hand.",
    };
  }

  // Search returns an array, reverse returns a single object. Both are read
  // here so the two callers don't each need their own unwrapping.
  const first = Array.isArray(body) ? body[0] : body;

  // LocationIQ reports no match as {"error": ...} — sometimes with a 404,
  // handled above, and sometimes with a 200.
  if (first && typeof first === "object" && typeof (first as Record<string, unknown>).error === "string") {
    return { ok: false, reason: "not-found", message: notFoundMessage };
  }

  const place = readPlace(first);
  if (!place) {
    return {
      ok: false,
      reason: Array.isArray(body) && body.length === 0 ? "not-found" : "unavailable",
      message: Array.isArray(body) && body.length === 0
        ? notFoundMessage
        : "Address lookup returned something this app couldn't read. Enter the coordinates below by hand.",
    };
  }

  return { ok: true, place };
}

/**
 * A free-text address, city, or shul name — whatever a gabbai would type.
 * Deliberately the loosest possible input: "770 Eastern Parkway Brooklyn",
 * "Saint Petersburg FL", and "33710" all resolve, and the form shows back
 * what came out so a wrong one is caught before it's saved rather than in
 * the lobby.
 */
export async function geocodeAddress(query: string): Promise<GeocodeOutcome> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, reason: "not-found", message: "Type an address or city to look up." };
  }

  const url = new URL(SEARCH);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  return request(url, `Nothing found for “${trimmed}”. Try a nearby city, or enter the coordinates below by hand.`);
}

/**
 * A US ZIP, structured rather than pasted into `q`. `postalcode` +
 * `countrycodes=us` is what stops "11213" matching a house number
 * somewhere, and it resolves to the ZIP's own center — which is exactly
 * the point at the one call site that uses this (the save-time check that
 * a shul's ZIP and its coordinates describe the same place).
 */
export async function geocodePostalCode(postalCode: string): Promise<GeocodeOutcome> {
  const trimmed = postalCode.trim();
  if (!trimmed) {
    return { ok: false, reason: "not-found", message: "No ZIP to look up." };
  }

  const url = new URL(SEARCH);
  url.searchParams.set("postalcode", trimmed);
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("limit", "1");
  return request(url, `No US ZIP matches ${trimmed}.`);
}

/**
 * Coordinates back to a place name — the other half of the save-time
 * check. A warning that says "your ZIP and your coordinates are 1,100
 * miles apart" is not actionable; one that names Brooklyn and St.
 * Petersburg tells a gabbai immediately which of the two fields is the
 * wrong one.
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeOutcome> {
  const url = new URL(REVERSE);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  return request(url, "Those coordinates don't land on a recognizable place.");
}
