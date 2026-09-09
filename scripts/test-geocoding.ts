/**
 * lib/geocoding — the LocationIQ parser and the distance helper.
 *
 * WHY THIS SUITE EXISTS, AND WHAT IT CANNOT DO: this sandbox cannot reach
 * us1.locationiq.com (the egress proxy refuses CONNECT), so the fixtures
 * below are built from LocationIQ's DOCUMENTED Nominatim-compatible
 * response shape — an array of objects with `display_name` and STRING
 * `lat`/`lon` — and are NOT a live capture. They are labelled that way
 * rather than presented as real data.
 *
 * That is precisely why most of these checks are about REFUSING a shape
 * rather than parsing the happy one. If the documented shape is wrong, the
 * happy-path check is the one that fails on a real key and the rest still
 * hold: what matters is that nothing unexpected is ever coerced into
 * coordinates and written to an org. `Number(null)` is 0, and 0,0 is a
 * real point in the Gulf of Guinea — a plausible-looking wrong answer is
 * the exact failure mode this whole task set out to remove, so an
 * unreadable response has to come back as an error, never as a number.
 *
 * Run with: npm run test:geocoding — not plain `node`. The module under
 * test imports `server-only`, which throws unless the `react-server`
 * export condition is set (see the npm script).
 */

import { geocodeAddress, geocodePostalCode, reverseGeocode } from "../lib/geocoding/locationiq.ts";
import { describeMiles, milesBetween } from "../lib/geocoding/distance.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

/*
 * One captured request, so the query string can be asserted too.
 *
 * Held on an object rather than in a bare `let`: TypeScript narrows a
 * `let` to its initializer's type when it sees no assignment in the
 * enclosing scope, and every assignment here happens inside the fetch stub
 * closure. That narrows `lastUrl` to `null`, and every `lastUrl?.x` read
 * then fails as a property access on `never`.
 */
const captured: { url: URL | null } = { url: null };
let calls = 0;

function stubFetch(reply: { status?: number; body?: unknown; unreadable?: boolean; throws?: boolean }) {
  const original = globalThis.fetch;
  captured.url = null;
  calls = 0;
  globalThis.fetch = (async (input: URL | string) => {
    calls += 1;
    captured.url = new URL(String(input));
    if (reply.throws) throw new Error("network down");
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      statusText: "",
      json: async () => {
        if (reply.unreadable) throw new Error("not json");
        return reply.body;
      },
    };
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// The documented shape. STRING lat/lon is the whole point of this fixture.
const DOCUMENTED_SEARCH_HIT = [
  {
    place_id: "323169951385",
    licence: "https://locationiq.com/attribution",
    osm_type: "node",
    lat: "40.6693616",
    lon: "-73.9421534",
    display_name: "770, Eastern Parkway, Crown Heights, Brooklyn, Kings County, New York, 11213, USA",
    class: "place",
    type: "house",
    importance: 0.001,
  },
];

process.env.GEOCODING_API_KEY = "test-key";

// ---- the happy path, against the documented shape -----------------------

{
  const restore = stubFetch({ body: DOCUMENTED_SEARCH_HIT });
  const outcome = await geocodeAddress("770 Eastern Parkway Brooklyn");
  restore();

  check(outcome.ok, "a documented-shape response resolves", outcome.ok ? "" : outcome.reason);
  check(
    outcome.ok && outcome.place.latitude === 40.6693616 && outcome.place.longitude === -73.9421534,
    "STRING lat/lon are parsed to numbers, not left as strings or coerced to NaN",
    outcome.ok ? `${outcome.place.latitude}, ${outcome.place.longitude}` : "",
  );
  check(
    outcome.ok && outcome.place.label.startsWith("770, Eastern Parkway"),
    "display_name becomes the label the gabbai reads back",
    outcome.ok ? outcome.place.label : "",
  );
  check(
    captured.url?.searchParams.get("key") === "test-key" && captured.url?.searchParams.get("format") === "json",
    "the key and format=json are on the request",
    captured.url?.searchParams.toString(),
  );
  check(captured.url?.searchParams.get("q") === "770 Eastern Parkway Brooklyn", "the query is passed through verbatim");
}

// A numeric lat/lon (were the documented shape ever to change) is accepted
// too — this is the one place the parser is deliberately lenient, because
// both are unambiguously a coordinate.
{
  const restore = stubFetch({ body: [{ display_name: "Somewhere", lat: 27.7898, lon: -82.7243 }] });
  const outcome = await geocodeAddress("x");
  restore();
  check(outcome.ok && outcome.place.latitude === 27.7898, "numeric lat/lon is accepted as well as string");
}

// ---- REFUSING everything that isn't a coordinate ------------------------

const REFUSALS: [string, { status?: number; body?: unknown; unreadable?: boolean; throws?: boolean }, "not-found" | "unavailable"][] = [
  ["an empty array (no match)", { body: [] }, "not-found"],
  ["a 404", { status: 404, body: { error: "Unable to geocode" } }, "not-found"],
  ["a 200 carrying LocationIQ's own {error} body", { body: { error: "Unable to geocode" } }, "not-found"],
  ["a 500", { status: 500, body: "" }, "unavailable"],
  ["a 429 rate limit", { status: 429, body: "" }, "unavailable"],
  ["a body that isn't JSON at all", { unreadable: true }, "unavailable"],
  ["a transport failure or timeout", { throws: true }, "unavailable"],
  ["a hit with no display_name", { body: [{ lat: "40.1", lon: "-73.1" }] }, "unavailable"],
  ["a hit with an empty display_name", { body: [{ display_name: "   ", lat: "40.1", lon: "-73.1" }] }, "unavailable"],
  ["lat: null — Number(null) is 0, a real point in the Gulf of Guinea", { body: [{ display_name: "X", lat: null, lon: "-73.1" }] }, "unavailable"],
  ["lat: \"\" — same coercion trap", { body: [{ display_name: "X", lat: "", lon: "-73.1" }] }, "unavailable"],
  ["a non-numeric lat", { body: [{ display_name: "X", lat: "north", lon: "-73.1" }] }, "unavailable"],
  ["a lat outside -90..90", { body: [{ display_name: "X", lat: "412.5", lon: "-73.1" }] }, "unavailable"],
  ["a lon outside -180..180", { body: [{ display_name: "X", lat: "40.1", lon: "-999" }] }, "unavailable"],
  ["a missing lon entirely", { body: [{ display_name: "X", lat: "40.1" }] }, "unavailable"],
];

for (const [label, reply, expected] of REFUSALS) {
  const restore = stubFetch(reply);
  const outcome = await geocodeAddress("anything");
  restore();
  check(
    !outcome.ok && outcome.reason === expected,
    `${label} is refused as "${expected}"`,
    outcome.ok ? `resolved to ${outcome.place.latitude}, ${outcome.place.longitude}` : outcome.reason,
  );
  check(
    !outcome.ok && outcome.message.length > 0 && outcome.message[0] === outcome.message[0].toUpperCase(),
    `${label} carries a sentence a gabbai can act on`,
    outcome.ok ? "" : outcome.message,
  );
}

// ---- no key: unconfigured, and NO request attempted --------------------

{
  delete process.env.GEOCODING_API_KEY;
  const restore = stubFetch({ body: DOCUMENTED_SEARCH_HIT });
  const outcome = await geocodeAddress("770 Eastern Parkway");
  restore();
  check(!outcome.ok && outcome.reason === "unconfigured", "with no GEOCODING_API_KEY the outcome is \"unconfigured\"");
  check(calls === 0, "and no request is made at all — not a keyless call that 401s", `${calls} calls`);
  process.env.GEOCODING_API_KEY = "test-key";
}

// An empty query never reaches the network either.
{
  const restore = stubFetch({ body: DOCUMENTED_SEARCH_HIT });
  const outcome = await geocodeAddress("   ");
  restore();
  check(!outcome.ok && calls === 0, "an empty query is refused without a request", `${calls} calls`);
}

// ---- the ZIP lookup is structured, not a free-text query ---------------

{
  const restore = stubFetch({ body: [{ display_name: "Brooklyn, NY 11213, USA", lat: "40.67", lon: "-73.94" }] });
  await geocodePostalCode("11213");
  restore();
  check(captured.url?.searchParams.get("postalcode") === "11213", "the ZIP goes in postalcode=, not q=", captured.url?.searchParams.toString());
  check(captured.url?.searchParams.get("q") === null, "and q= is not set, so 11213 can't match a house number");
  check(
    captured.url?.searchParams.get("countrycodes") === "us",
    "countrycodes=us is pinned — which is also what makes a non-US postal code simply not match, so the save-time warning stays quiet on one",
  );
}

// ---- reverse returns a bare object, not an array -----------------------

{
  const restore = stubFetch({
    body: { display_name: "Saint Petersburg, Pinellas County, Florida, USA", lat: "27.7898", lon: "-82.7243" },
  });
  const outcome = await reverseGeocode(27.7898, -82.7243);
  restore();
  check(outcome.ok && outcome.place.label.startsWith("Saint Petersburg"), "reverse geocoding reads a single object, not an array",
    outcome.ok ? outcome.place.label : outcome.reason);
  check(captured.url?.searchParams.get("lat") === "27.7898" && captured.url?.searchParams.get("lon") === "-82.7243",
    "with the coordinates on the request");
}

// ---- the distance check the save-time warning turns on ----------------

const CROWN_HEIGHTS = { latitude: 40.6694, longitude: -73.9422 };
const BOROUGH_PARK = { latitude: 40.6329, longitude: -73.9906 };
const ST_PETERSBURG = { latitude: 27.7898, longitude: -82.7243 };

const farApart = milesBetween(CROWN_HEIGHTS, ST_PETERSBURG);
check(farApart > 900 && farApart < 1200, "Brooklyn to St. Petersburg is ~1,000 miles — well over the 30-mile threshold",
  farApart.toFixed(1));
const nearby = milesBetween(CROWN_HEIGHTS, BOROUGH_PARK);
check(nearby < 30, "Crown Heights to Borough Park is under the threshold, so a neighboring-ZIP shul is never warned about",
  nearby.toFixed(1));
check(milesBetween(CROWN_HEIGHTS, CROWN_HEIGHTS) === 0, "a point is zero miles from itself — no floating-point NaN from acos");
check(describeMiles(farApart).includes(","), "a long distance reads with a thousands separator", describeMiles(farApart));
check(describeMiles(nearby).startsWith("about 3.6"), "a short one keeps one decimal rather than rounding to a whole number",
  describeMiles(nearby));

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
