/*
 * Resolving an org/screen down to a Chabad.org location — plan.md §5c,
 * the "Location ID" question the proposal in this thread investigated by
 * hand before any of this was written.
 *
 * Client-safe (no `server-only`, no fetch): both the cache-warming cron
 * (server) and the editor's live preview (also server, but a different
 * route) need the exact same resolution, and neither needs anything this
 * file doesn't already have — it's pure data in, pure data out.
 */

/**
 * `locationtype=2` on Chabad's endpoint treats `locationid` as a literal
 * US ZIP code — confirmed by hand against several chabad.org URLs
 * (`locationId/11213/locationType/2`, `.../10011/.../2`) and against the
 * `chabad-org-zmanim` npm client's own documented parameter semantics.
 * `locationtype=1` is Chabad's own opaque internal city numbering (370 =
 * NYC, 120 = Chicago) with no discovered public search endpoint — a shul
 * only has one of these if a gabbai copied it by hand off their own
 * chabad.org candle-lighting page.
 */
export type ChabadLocation = {
  locationId: string;
  locationType: "1" | "2";
  /** The `zmanim_cache.location_id` key this resolves to — namespaced by
   *  which kind of id it is, so a ZIP and a manually-entered city id can
   *  never collide (schema.md §8's own `geo:40.669,-73.943` precedent for
   *  Hebcal is the same idea). */
  cacheKey: string;
};

/** US ZIP only, same restriction plan.md §5c already decided for MyZmanim
 *  ("ZIP-level only... don't market address-level precision") and for the
 *  same reason: `postal_code` is a free-text field that may hold a non-US
 *  postal code, and handing that to Chabad as a ZIP would silently ask for
 *  the wrong location rather than failing loudly. Matches on the 5-digit
 *  prefix so a ZIP+4 (`11213-1234`) still resolves. */
const US_ZIP = /^\d{5}/;

function firstUsZip(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && US_ZIP.test(trimmed)) return trimmed.match(US_ZIP)![0];
  }
  return null;
}

function firstNonEmpty(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Screen overrides org — the same tier order latitude/longitude and
 * `zmanim_provider` itself already use (lib/bundle/build.ts, schema.md's
 * comments on both tables) — resolved once here rather than reimplemented
 * at each of this function's callers (the cache-warming cron, the bundle
 * builder, the editor's live preview).
 *
 * ZIP-first: `postal_code` needs no lookup at all under `locationtype=2`.
 * `zmanim_location_id` (screens.sql's own generic column, and orgs' new
 * one — see the migration adding it) is the fallback for a shul with no US
 * ZIP on file: whatever numeric id a gabbai copied out of their own
 * chabad.org candle-lighting page URL. That id could itself be either
 * locationtype, but if it were a ZIP the ZIP-first branch above would
 * already have matched, so treating this fallback as always
 * `locationtype=1` (a city id) is deliberate, not a guess — see the
 * proposal in this thread for the reasoning.
 *
 * `null` means genuinely unresolvable: no ZIP, no manual id, on either
 * tier. Callers treat that the same way `useBoardLocation()` treats a
 * missing org location — an honest empty state, never a fetch to a
 * malformed URL.
 */
export function resolveChabadLocation(input: {
  screenPostalCode?: string | null;
  orgPostalCode?: string | null;
  screenZmanimLocationId?: string | null;
  orgZmanimLocationId?: string | null;
}): ChabadLocation | null {
  const zip = firstUsZip(input.screenPostalCode, input.orgPostalCode);
  if (zip) return { locationId: zip, locationType: "2", cacheKey: `zip:${zip}` };

  const manual = firstNonEmpty(input.screenZmanimLocationId, input.orgZmanimLocationId);
  if (manual) return { locationId: manual, locationType: "1", cacheKey: `city:${manual}` };

  return null;
}
