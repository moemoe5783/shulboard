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
 * NYC, 120 = Chicago).
 *
 * THERE IS A PUBLIC SEARCH FOR THOSE IDS NOW — `Get_Locations`,
 * lib/zmanim/chabad-locations.ts — which is what makes `locationtype=1`
 * reachable for a non-US shul instead of something a gabbai had to dig out
 * of a chabad.org URL by hand.
 */
export type ChabadLocation = {
  locationId: string;
  locationType: "1" | "2";
  /**
   * The `zmanim_cache.location_id` key this resolves to — namespaced by
   * which kind of id it is (schema.md §8's own `geo:40.669,-73.943`
   * precedent for Hebcal is the same idea).
   *
   * KEYED ON THE TYPE, NOT ON WHERE THE VALUE CAME FROM. A search result
   * with `ItemType` "2" carries a ZIP, and it gets `zip:<id>` — the same
   * key the shul's own `postal_code` would produce — so two shuls that
   * arrive at the same ZIP by different routes share one cached row, which
   * is plan.md §5c's whole point of the cache. Only a genuine city id gets
   * `city:<id>`.
   */
  cacheKey: string;
  /**
   * The place this id is supposed to be — the search's own Title,
   * `orgs.zmanim_location_name`.
   *
   * LOAD-BEARING, not a label: it is the only thing a city id's zmanim
   * response can be verified against, since a `LocationName` of "Brooklyn,
   * NY" is a perfectly normal-looking answer to a request that was
   * supposed to be Lugano. See `verifyLocationName` in
   * lib/zmanim/chabad-adapter.ts.
   *
   * `null` for a ZIP, which verifies against itself, and for an id stored
   * before the search existed, which cannot be verified at all.
   */
  expectedName: string | null;
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
 * `null` means genuinely unresolvable: no ZIP, no searched location, on
 * either tier. Callers treat that the same way `useBoardLocation()` treats
 * a missing org location — an honest empty state, never a fetch to a
 * malformed URL.
 */
export function resolveChabadLocation(input: {
  screenPostalCode?: string | null;
  orgPostalCode?: string | null;
  screenZmanimLocationId?: string | null;
  orgZmanimLocationId?: string | null;
  /** `orgs.zmanim_location_type` / `screens`' equivalent when it gains
   *  one. Null for an id stored before the search existed — read as "1",
   *  which is what this function already assumed for that column. */
  screenZmanimLocationType?: string | null;
  orgZmanimLocationType?: string | null;
  /** `orgs.zmanim_location_name` — the search's own Title for the chosen
   *  id, for verification. */
  screenZmanimLocationName?: string | null;
  orgZmanimLocationName?: string | null;
}): ChabadLocation | null {
  const zip = firstUsZip(input.screenPostalCode, input.orgPostalCode);
  if (zip) return { locationId: zip, locationType: "2", cacheKey: `zip:${zip}`, expectedName: null };

  /*
   * The three searched fields are read from THE SAME TIER, not each from
   * whichever tier has one. A screen's id with an org's type would be two
   * halves of two different places — and the type is what decides whether
   * the id means a city or a ZIP, so mixing them is precisely the silent
   * wrong-place bug the type column exists to prevent.
   */
  const searched =
    firstNonEmpty(input.screenZmanimLocationId) !== null
      ? {
          id: input.screenZmanimLocationId!.trim(),
          type: input.screenZmanimLocationType,
          name: input.screenZmanimLocationName,
        }
      : firstNonEmpty(input.orgZmanimLocationId) !== null
        ? {
            id: input.orgZmanimLocationId!.trim(),
            type: input.orgZmanimLocationType,
            name: input.orgZmanimLocationName,
          }
        : null;

  if (!searched) return null;

  // Null reads as "1" — see the type parameter's own note, and the
  // migration's on why nothing was backfilled. Anything other than "1" or
  // "2" is treated as "1" too rather than rejected: the column has a CHECK
  // constraint, so a third value can only arrive through a hand-written
  // SQL update, and refusing to resolve at all there would blank a board
  // over a typo somebody can see in the settings form.
  const locationType = searched.type === "2" ? "2" : "1";
  const expectedName = firstNonEmpty(searched.name);

  return {
    locationId: searched.id,
    locationType,
    cacheKey: locationType === "2" ? `zip:${searched.id}` : `city:${searched.id}`,
    // A ZIP verifies against itself; a name alongside one would be a
    // second, weaker check on the same thing.
    expectedName: locationType === "2" ? null : expectedName,
  };
}
