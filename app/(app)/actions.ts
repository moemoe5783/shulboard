"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { geocodeAddress, geocodePostalCode, reverseGeocode } from "@/lib/geocoding/locationiq";
import { describeMiles, milesBetween } from "@/lib/geocoding/distance";
import { upcomingCandleLighting } from "@/lib/hebrew/candle-times";
import { formatTimeOfDay } from "@/lib/hebrew/format";
import { ACTIVE_ORG_COOKIE, getMemberships, hasRoleAtLeast, requireActiveOrg, requireUser } from "@/lib/orgs";
import { SIGN_IN_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { resolveChabadLocation } from "@/lib/zmanim/location";
import { searchChabadLocations } from "@/lib/zmanim/chabad-locations";
import { fetchChabadZmanim } from "@/lib/zmanim/chabad-adapter";
import { warmChabadLocation } from "@/lib/zmanim/warm";

const YEAR = 60 * 60 * 24 * 365;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Both-or-neither latitude/longitude, in range — shared by org creation and
 * the settings form, so the two never drift into disagreeing about what a
 * valid coordinate pair is.
 *
 * A half-set pair is worse than neither: candle lighting and the Hebrew-date
 * widgets would think they're configured and compute nonsense (plan.md §3b).
 */
function parseLocationFields(formData: FormData): { latitude: number | null; longitude: number | null } | { error: string } {
  const latitudeRaw = String(formData.get("latitude") ?? "").trim();
  const longitudeRaw = String(formData.get("longitude") ?? "").trim();

  if (Boolean(latitudeRaw) !== Boolean(longitudeRaw)) {
    return { error: "Enter both latitude and longitude, or leave both blank." };
  }
  if (!latitudeRaw && !longitudeRaw) {
    return { latitude: null, longitude: null };
  }

  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { error: "Latitude has to be a number between -90 and 90." };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { error: "Longitude has to be a number between -180 and 180." };
  }
  return { latitude, longitude };
}

/**
 * The place name the coordinates came from — a cached label for the
 * settings page to show instead of two decimal numbers.
 *
 * Coupled to the coordinates on purpose: a label with no coordinates
 * describes nothing, so it is dropped in that case rather than stored
 * alone. The form already clears it whenever the coordinates are edited by
 * hand (LocationLookup.tsx), and this is the server-side half of the same
 * rule — a hand-posted label against a blank location cannot get in.
 */
function parseLocationLabel(formData: FormData, hasCoordinates: boolean): string | null {
  if (!hasCoordinates) return null;
  return String(formData.get("locationLabel") ?? "").trim().slice(0, 300) || null;
}

/**
 * The settings form's own zmanim fields — its ZIP (`postal_code`, shared
 * with the never-built MyZmanim onboarding this column already existed
 * for) and the manual Chabad location id fallback (lib/zmanim/location.ts)
 * for a shul with no US ZIP on file.
 *
 * THERE IS NO LONGER A PROVIDER FIELD TO PARSE. Chabad.org is the only
 * zmanim source (lib/zmanim/provider.ts), so the form no longer offers a
 * choice and no longer posts one — a one-item dropdown is not a setting.
 * The stored `zmanim_provider` column is deliberately left ALONE rather
 * than rewritten to `'chabad'` on every save: the DB enum still carries all
 * four values, nothing migrates, and `effectiveZmanimProvider()` is the one
 * place that decides what a stored value resolves to. Re-offering Hebcal
 * later is a change to that function and to this form, not a data repair.
 *
 * `chabadEnabled` is still checked here, server-side, because
 * ZMANIM_CHABAD_ENABLED (docs/environment.md) is the actual runtime gate on
 * reaching chabad.org at all. It no longer gates a form value — it gates
 * whether saving a ZIP for this purpose means anything — so a save with the
 * flag off is accepted rather than refused: the ZIP is a fact about the
 * shul either way, and refusing it would make the flag look like a bug.
 */
function parseZmanimFields(
  formData: FormData,
): {
  postal_code: string | null;
  zmanim_location_id: string | null;
  zmanim_location_type: string | null;
  zmanim_location_name: string | null;
} {
  const postalCode = String(formData.get("postalCode") ?? "").trim();
  const zmanimLocationId = String(formData.get("zmanimLocationId") ?? "").trim();
  const zmanimLocationType = String(formData.get("zmanimLocationType") ?? "").trim();
  const zmanimLocationName = String(formData.get("zmanimLocationName") ?? "").trim();

  /*
   * THE THREE SEARCHED FIELDS MOVE TOGETHER OR NOT AT ALL. An id without
   * its type is an id whose meaning is a guess, and an id without its name
   * cannot be verified against the zmanim response — which is the whole
   * defence against caching another country's times
   * (lib/zmanim/chabad-adapter.ts). So a post carrying only some of them
   * clears all three rather than storing a half-configured location that
   * looks configured.
   *
   * The type is checked against the same two values the column's own CHECK
   * constraint allows, so a hand-crafted POST cannot get a third value as
   * far as a database error.
   */
  const searched =
    zmanimLocationId && (zmanimLocationType === "1" || zmanimLocationType === "2") && zmanimLocationName
      ? { id: zmanimLocationId, type: zmanimLocationType, name: zmanimLocationName }
      : null;

  return {
    postal_code: postalCode || null,
    zmanim_location_id: searched?.id ?? null,
    zmanim_location_type: searched?.type ?? null,
    zmanim_location_name: searched?.name ?? null,
  };
}

export type CreateOrgState = { error?: string };

/**
 * Creates the org. The org_members owner row is created by a database trigger in
 * the same transaction, not by a second insert here — the RLS policy on
 * org_members requires admin, and the creator is not a member yet, so a second
 * insert would either fail or need the service role.
 */
export async function createOrg(
  _previous: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();

  if (!name) return { error: "Give the shul a name." };
  if (!timezone) return { error: "Pick a timezone." };

  const location = parseLocationFields(formData);
  if ("error" in location) return { error: location.error };
  const { latitude, longitude } = location;

  // The location lookup derives this from its result (LocationLookup.tsx),
  // so the new-shul form posts it too. Persisted here rather than dropped:
  // a gabbai who looks up an address at signup should not have to find the
  // ZIP again the first time he picks Chabad.org as a zmanim source.
  const postalCode = String(formData.get("postalCode") ?? "").trim() || null;

  const base = slugify(name) || "shul";
  const supabase = await createClient();

  // Slugs are unique across the product, so a common name collides. Retry with a
  // suffix rather than making the gabbai invent a unique name.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;

    // Deliberately no .select() on the insert.
    //
    // PostgREST turns .insert().select() into INSERT ... RETURNING, and Postgres
    // applies the SELECT policy to a RETURNING clause. The orgs SELECT policy is
    // is_org_member(id), and the membership row does not exist yet at that point:
    // it is created by the orgs_add_creator_as_owner AFTER INSERT trigger, which
    // fires at the end of the statement. So the row goes in and the read of it is
    // refused, and the whole insert fails with an RLS violation.
    //
    // Insert first, read back afterwards, by which time the trigger has run and
    // the policy passes. Slugs are globally unique, so this identifies the row.
    const { error } = await supabase
      .from("orgs")
      .insert({
        name,
        slug,
        timezone,
        latitude,
        longitude,
        postal_code: postalCode,
        location_label: parseLocationLabel(formData, latitude !== null),
        created_by: user.id,
      });

    if (!error) {
      const { data, error: readError } = await supabase
        .from("orgs")
        .select("id")
        .eq("slug", slug)
        .single();

      if (readError || !data) {
        return {
          error:
            "The shul was created but could not be opened. Reload the page — it should be in the switcher.",
        };
      }

      const cookieStore = await cookies();
      cookieStore.set(ACTIVE_ORG_COOKIE, data.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: YEAR,
      });
      redirect("/");
    }

    // 23505 is unique_violation. Anything else is a real failure.
    if (error.code !== "23505") {
      return {
        error: `That didn't save: ${error.message}. Check the name and try again.`,
      };
    }
  }

  return { error: "That name kept colliding. Try a slightly different one." };
}

export type LocationLookupState =
  | { status: "idle" }
  | {
      status: "found";
      label: string;
      latitude: number;
      longitude: number;
      /** From LocationIQ's structured `address.postcode`, not scraped out
       *  of the label. `null` for a result that has none — the form leaves
       *  the stored ZIP alone in that case rather than clearing it. */
      postcode: string | null;
      candleLighting: string | null;
      candleLightingWhen: string | null;
    }
  | { status: "failed"; message: string };

/**
 * Resolves what a gabbai typed into a place, and hands back a sanity check
 * he can actually judge: the resolved place name, and the next candle
 * lighting there.
 *
 * The candle lighting is the load-bearing half. A gabbai cannot tell
 * 40.669 from 40.969, but he knows what time his shul lights on Friday, so
 * a coordinate that is wrong by enough to matter shows up here as a time
 * that is visibly wrong — on the settings page, before anything is saved,
 * rather than being discovered in the lobby. It is computed through the
 * same `upcomingCandleLighting` every board renders from
 * (lib/hebrew/candle-times.ts), not a second approximation, so the preview
 * and the screen can't disagree.
 *
 * `timezone` comes from the form's own currently-selected value rather
 * than from the geocoder (which doesn't return one) or from the saved row
 * (which the gabbai may be in the middle of changing). That makes the
 * preview a check on the timezone too: pick the wrong zone and the
 * previewed time is off by hours, which is exactly as visible as it should
 * be.
 *
 * Nothing is written here. This is a read, and the coordinate fields fill
 * only when the gabbai confirms the result in the form.
 */
export async function lookupShulLocation(
  query: string,
  timezone: string,
): Promise<LocationLookupState> {
  // A signed-in user and nothing more. Deliberately NOT the save's own
  // admin-of-the-active-org check: this same lookup runs on the new-shul
  // form, where the user has no org yet and there is no role to have, so
  // requiring one there would break the lookup for exactly the person who
  // needs it most — someone setting up their first shul.
  //
  // Requiring a session is still the point: without it this route is an
  // open geocoding proxy spending this deployment's quota for anyone who
  // finds it.
  await requireUser();

  const outcome = await geocodeAddress(query);
  if (!outcome.ok) return { status: "failed", message: outcome.message };

  const { label, latitude, longitude, postcode } = outcome.place;

  // A timezone the gabbai hasn't picked yet, or a hand-posted junk value:
  // the preview is worth less without it but the coordinates are still
  // good, so this degrades to showing the place alone rather than failing
  // the whole lookup.
  const preview = previewCandleLighting({ latitude, longitude, timeZone: timezone });

  return { status: "found", label, latitude, longitude, postcode, ...preview };
}

/** Non-throwing on a bad timezone (`Intl` throws on an unknown zone) and on
 *  a latitude where there is no sunset to compute from — a shul north of
 *  the arctic circle in June has no candle lighting @hebcal/core can
 *  return, and that is a real place, not a bug to crash on. */
function previewCandleLighting(location: {
  latitude: number;
  longitude: number;
  timeZone: string;
}): { candleLighting: string | null; candleLightingWhen: string | null } {
  try {
    const event = upcomingCandleLighting(new Date(), location);
    if (!event) return { candleLighting: null, candleLightingWhen: null };

    return {
      candleLighting: formatTimeOfDay(event.eventTime, { hour12: true, timeZone: location.timeZone }),
      candleLightingWhen: new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: location.timeZone,
      }).format(event.eventTime),
    };
  } catch {
    return { candleLighting: null, candleLightingWhen: null };
  }
}

export type ChabadCitySearchState =
  | { status: "idle" }
  | { status: "failed"; message: string }
  | {
      status: "found";
      suggestions: { value: string; type: "1" | "2"; title: string }[];
      truncated: boolean;
    };

/**
 * Chabad.org's own location search, for a shul with no US ZIP — plan.md
 * §5c, and the thing that makes `locationtype=1` reachable at all.
 *
 * ADMIN, and not merely signed-in like `lookupShulLocation` is. That one is
 * deliberately looser because it also runs on the new-shul form, where the
 * user has no org yet; this only ever runs in settings, and it puts
 * requests on an endpoint this product is a guest on — so the narrower
 * gate is the right one and costs nothing.
 *
 * Gated on ZMANIM_CHABAD_ENABLED too. Searching is harmless in itself, but
 * offering a search whose result cannot be fetched against would be
 * offering a dead end.
 */
export async function searchChabadCity(query: string): Promise<ChabadCitySearchState> {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "admin")) {
    return { status: "failed", message: "Only an owner or admin can change shul settings." };
  }
  if (process.env.ZMANIM_CHABAD_ENABLED !== "true") {
    return { status: "failed", message: "Chabad.org isn't turned on for this product yet." };
  }

  const outcome = await searchChabadLocations(query);
  if (!outcome.ok) return { status: "failed", message: outcome.message };

  return {
    status: "found",
    suggestions: outcome.suggestions.map(({ value, type, title }) => ({ value, type, title })),
    truncated: outcome.truncated,
  };
}

export type ChabadCityCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "failed"; message: string }
  | {
      status: "confirmed";
      /** The name chabad.org's zmanim endpoint itself returned for this id
       *  — the thing being confirmed, not the thing that was asked for. */
      locationName: string;
      candleLighting: string | null;
      candleLightingWhen: string | null;
    };

/**
 * Confirms a searched location by actually fetching zmanim for it, and
 * showing back what chabad.org says the place is called and when it lights
 * this Friday.
 *
 * THIS IS THE CONFIRM STEP, and it is a stronger one than the address
 * lookup's. That one previews a candle lighting @hebcal/core computes from
 * the coordinates it just resolved — a good sanity check on coordinates and
 * a timezone. This one exercises the entire path the board will use: the
 * id, the type, the case-sensitive parameters, and the verification of the
 * response's own `LocationName` against the Title the search returned. A
 * mismatch surfaces here, before anything is written, instead of silently
 * at the next warm.
 *
 * EIGHT DAYS, not the ninety-two a warm asks for. A confirmation needs one
 * Friday in range and nothing more, and this runs on a button a gabbai may
 * press several times while choosing between suggestions — putting a
 * hundred-kilobyte request behind each press on an endpoint this product is
 * a guest on would be rude for no gain.
 *
 * Nothing is cached by this. It reads and reports; the warming cron and the
 * "Fetch now" button are what write `zmanim_cache`.
 */
export async function checkChabadCity(
  value: string,
  type: string,
  title: string,
): Promise<ChabadCityCheckState> {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "admin")) {
    return { status: "failed", message: "Only an owner or admin can change shul settings." };
  }
  if (process.env.ZMANIM_CHABAD_ENABLED !== "true") {
    return { status: "failed", message: "Chabad.org isn't turned on for this product yet." };
  }
  if (type !== "1" && type !== "2") {
    return { status: "failed", message: "That location came back in a shape this app didn't understand." };
  }

  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("timezone").eq("id", org.orgId).single();
  // The saved timezone, not one posted from the form: this call converts
  // wall-clock strings to instants with it, and a wrong zone would move
  // the previewed time by an hour while the id itself was perfectly good.
  const timeZone = data?.timezone ?? "UTC";

  const today = new Date().toISOString().slice(0, 10);
  const [year, month, day] = today.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);

  try {
    const result = await fetchChabadZmanim({
      locationId: value,
      locationType: type,
      expectedName: title,
      startDate: today,
      endDate: end,
      timeZone,
    });

    const lightingDate = result.candleLightingDates[0];
    const lighting = lightingDate ? result.times[lightingDate]?.candle_lighting : undefined;

    return {
      status: "confirmed",
      locationName: result.location,
      // Chabad's own rendered string, verbatim — §5c, and the point of
      // showing it: a gabbai judges the time, not the id.
      candleLighting: lighting && "display" in lighting ? lighting.display : null,
      candleLightingWhen: lightingDate
        ? new Intl.DateTimeFormat("en-US", {
            weekday: "long",
            day: "numeric",
            month: "long",
            timeZone: "UTC",
          }).format(new Date(`${lightingDate}T12:00:00Z`))
        : null,
    };
  } catch (cause) {
    // The verification failure verbatim, not a paraphrase. If the response
    // came back for Brooklyn, the message names Brooklyn — which is the
    // one sentence that tells a gabbai the suggestion he picked is not the
    // place he wanted.
    return { status: "failed", message: cause instanceof Error ? cause.message : String(cause) };
  }
}

export type UpdateOrgSettingsState = { error?: string; saved?: boolean; warning?: string };

/** ~30 miles. Wide enough that a shul's ZIP centroid and its actual
 *  building never trip it — a ZIP is a few miles across at most, and
 *  neighboring-town coordinates are still the same zmanim to the minute —
 *  narrow enough to catch the mistake this exists for, a ZIP and a set of
 *  coordinates that describe different states. */
const LOCATION_MISMATCH_MILES = 30;

/**
 * Does the shul's ZIP describe the same place as its coordinates?
 *
 * NEVER BLOCKS THE SAVE, by design. Both fields are legitimately editable,
 * a gabbai may be part-way through changing one, and the geocoder is
 * allowed to be unavailable — refusing a save on any of that would be
 * worse than the mismatch. So this runs after the row is written and only
 * ever returns prose.
 *
 * It also stays quiet unless it is genuinely sure: no key, either lookup
 * failing, or a `postal_code` that isn't a US ZIP (`geocodePostalCode`
 * pins `countrycodes=us`, so a foreign postcode simply doesn't match) all
 * return `null`. A warning invented from a failed lookup would be worse
 * than no warning at all.
 *
 * Both places are named, not just the distance: "1,100 miles apart" is not
 * actionable, "the ZIP is in Brooklyn and the coordinates are in St.
 * Petersburg" tells a gabbai which field is wrong.
 */
async function checkLocationAgreement(
  postalCode: string | null,
  latitude: number | null,
  longitude: number | null,
): Promise<string | null> {
  if (!postalCode || latitude === null || longitude === null) return null;

  // Sequentially, not in parallel: LocationIQ's free tier allows 2 requests
  // per second and these are two of them (lib/geocoding/locationiq.ts).
  const zip = await geocodePostalCode(postalCode);
  if (!zip.ok) return null;
  const coordinates = await reverseGeocode(latitude, longitude);
  if (!coordinates.ok) return null;

  const miles = milesBetween(zip.place, coordinates.place);
  if (miles <= LOCATION_MISMATCH_MILES) return null;

  return (
    `Saved, but check the location: ZIP ${postalCode} is ${zip.place.label}, ` +
    `while the coordinates are ${coordinates.place.label} — ${describeMiles(miles)} apart. ` +
    `Chabad.org looks up zmanim by the ZIP while the Hebrew date and daf are computed from the ` +
    `coordinates, so one of the two is describing the wrong place.`
  );
}

/**
 * Updates the active org's name, timezone and coordinates — the one place
 * these can be changed after signup. Location especially: candle lighting
 * and the Hebrew-date/Daf-Yomi widgets are wrong without it (plan.md §3b),
 * and org creation is otherwise the only place that ever asked.
 *
 * The RLS policy on `orgs` already requires admin to update the row; this
 * check is defence in depth so a non-admin gets the same sentence-case
 * error the form would show for any other failure, rather than a raw
 * Postgres permission message.
 */
export async function updateOrgSettings(
  _previous: UpdateOrgSettingsState,
  formData: FormData,
): Promise<UpdateOrgSettingsState> {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "admin")) {
    return { error: "Only an owner or admin can change shul settings." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();

  if (!name) return { error: "Give the shul a name." };
  if (!timezone) return { error: "Pick a timezone." };

  const location = parseLocationFields(formData);
  if ("error" in location) return { error: location.error };
  const { latitude, longitude } = location;

  const zmanim = parseZmanimFields(formData);

  const supabase = await createClient();
  const { error } = await supabase
    .from("orgs")
    .update({
      name,
      timezone,
      latitude,
      longitude,
      location_label: parseLocationLabel(formData, latitude !== null),
      ...zmanim,
    })
    .eq("id", org.orgId);

  if (error) {
    return { error: `That didn't save: ${error.message}. Check the fields and try again.` };
  }

  // The nav rail shows the org's name and every page under this layout reads
  // its own fresh copy of the row, so a rename or a timezone change should
  // not need a hard reload to show up.
  revalidatePath("/", "layout");

  // After the write, never instead of it — see checkLocationAgreement.
  const warning = await checkLocationAgreement(zmanim.postal_code, latitude, longitude);
  return { saved: true, ...(warning ? { warning } : {}) };
}

export type FetchZmanimNowState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "failed"; message: string };

/**
 * How recently this location may have been fetched before "Fetch now"
 * refuses. Chabad's endpoint is undocumented and has no ToS with this
 * project (plan.md §10.4), so a button that fires it must not be usable as
 * a hammer.
 *
 * PER LOCATION, NOT PER ORG — deliberately stricter than per-org, and the
 * grain that actually matters. Twenty Crown Heights shuls resolve to one
 * ZIP and one cache row (plan.md §5c), so a per-org limit would let those
 * twenty admins hit the same location twenty times a minute. This uses
 * `zmanim_cache.fetched_at` for the location itself, which is durable
 * across deploys and cold starts in a way an in-memory counter is not, and
 * needs no new column.
 */
const FETCH_NOW_COOLDOWN_MS = 60_000;

/**
 * Warms this org's own Chabad location on demand.
 *
 * WHY IT EXISTS: the cron is right for steady state but leaves a gabbai who
 * has just picked Chabad.org with nothing to do but wait, and no way to
 * tell "the cron hasn't run yet" from "the cron is broken". This answers
 * that question directly, with the day counts, in the place the setting was
 * changed.
 *
 * It runs `warmChabadLocation` — the same function the cron calls, not a
 * second copy — so the two can't drift into caching different shapes. That
 * function is what holds the service-role key (`zmanim_cache` has a SELECT
 * policy and deliberately no write policy at all, so nothing running as a
 * tenant can write it); this action holds no key of its own and reads the
 * org row through the caller's own RLS-scoped client.
 *
 * It warms the SAVED row, not what is currently typed into the form, and
 * says which location it used — a gabbai who has changed the ZIP without
 * saving sees the old one named back rather than a success message about
 * the wrong place.
 */
export async function fetchChabadZmanimNow(): Promise<FetchZmanimNowState> {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "admin")) {
    return { status: "failed", message: "Only an owner or admin can fetch zmanim." };
  }

  // The same runtime gate the cron checks, for the same reason — the org
  // settings page only offering the option is not the gate
  // (docs/environment.md).
  if (process.env.ZMANIM_CHABAD_ENABLED !== "true") {
    return { status: "failed", message: "Chabad.org isn't turned on for this product yet." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orgs")
    .select("timezone, postal_code, zmanim_location_id, zmanim_location_type, zmanim_location_name")
    .eq("id", org.orgId)
    .single();

  if (error || !data) {
    return { status: "failed", message: "Couldn't read this shul's settings. Reload and try again." };
  }

  const location = resolveChabadLocation({
    orgPostalCode: data.postal_code,
    orgZmanimLocationId: data.zmanim_location_id,
    orgZmanimLocationType: data.zmanim_location_type,
    orgZmanimLocationName: data.zmanim_location_name,
  });
  if (!location) {
    return {
      status: "failed",
      message:
        "This shul has no ZIP or Chabad.org city on file. Look one up in the location section, save, then fetch.",
    };
  }

  // Readable under RLS by any signed-in user (the table's one policy), so
  // the cooldown check needs no elevated client of its own.
  const { data: recent } = await supabase
    .from("zmanim_cache")
    .select("fetched_at")
    .eq("provider", "chabad")
    .eq("location_id", location.cacheKey)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent?.fetched_at) {
    const elapsed = Date.now() - new Date(recent.fetched_at).getTime();
    if (elapsed < FETCH_NOW_COOLDOWN_MS) {
      const wait = Math.ceil((FETCH_NOW_COOLDOWN_MS - elapsed) / 1000);
      return {
        status: "failed",
        message: `${location.locationId} was fetched less than a minute ago. Wait ${wait}s and try again.`,
      };
    }
  }

  const outcome = await warmChabadLocation({ ...location, timezone: data.timezone });

  if (outcome.status === "failed") {
    // The provider's own message verbatim, not a paraphrase: this button
    // exists so a gabbai can tell a broken fetch from a cron that hasn't
    // run, and "something went wrong" answers neither.
    return { status: "failed", message: `Fetching ${location.locationId} failed: ${outcome.error}` };
  }

  const { dates, datesWithCandleLighting, lastDate } = outcome;

  if (datesWithCandleLighting === 0) {
    return {
      status: "done",
      message:
        `Fetched ${location.locationId}, but not one date had a candle-lighting time. ` +
        `Worth reporting — the window covers thirteen Fridays, so this points at chabad.org ` +
        `having changed what it sends.`,
    };
  }

  // How far ahead the screens are covered, which is the only thing this
  // answers that a gabbai can act on. The day count is real now: this
  // endpoint returns every day in the range, not only the candle-lighting
  // ones, so both numbers mean something and they mean different things.
  return {
    status: "done",
    message:
      `Fetched zmanim for ${location.locationId} through ${formatCoverageDate(lastDate)}. ` +
      `${dates} days, ${datesWithCandleLighting} with candle lighting.`,
  };
}

/** "2026-12-10" -> "December 10". Read out of a date chabad.org itself
 *  returned, so it is already the right calendar day in the shul's own
 *  zone — parsed as UTC noon rather than midnight so no timezone this
 *  formatter runs in can roll it back a day. */
function formatCoverageDate(isoDate: string | null): string {
  if (!isoDate) return "no date";
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(parsed);
}

/**
 * Remembers which org the user is looking at.
 *
 * The membership check is not decoration: without it a hand-written form post
 * would put another shul's id in the cookie. getActiveOrg() also refuses ids
 * outside the user's memberships, so this is the second of two gates.
 */
export async function setActiveOrg(formData: FormData): Promise<void> {
  const orgId = String(formData.get("orgId") ?? "");
  const memberships = await getMemberships();

  if (!memberships.some((membership) => membership.orgId === orgId)) {
    redirect("/");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: YEAR,
  });

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORG_COOKIE);

  redirect(SIGN_IN_PATH);
}
