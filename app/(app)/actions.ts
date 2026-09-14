"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { geocodeAddress } from "@/lib/geocoding/locationiq";
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
      /** ISO country code, lowercased. Lets the settings preview say "US
       *  only" before the confirm rather than only on the save. */
      countryCode: string | null;
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

  const { label, latitude, longitude, postcode, countryCode } = outcome.place;

  // A timezone the gabbai hasn't picked yet, or a hand-posted junk value:
  // the preview is worth less without it but the coordinates are still
  // good, so this degrades to showing the place alone rather than failing
  // the whole lookup.
  const preview = previewCandleLighting({ latitude, longitude, timeZone: timezone });

  return { status: "found", label, latitude, longitude, postcode, countryCode, ...preview };
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

export type UpdateOrgSettingsState = { error?: string; saved?: boolean };

/**
 * Updates the active org's name and timezone — nothing else.
 *
 * LOCATION IS NOT HERE ANY MORE. It is set by `saveShulAddress` below, from
 * one address field, which geocodes and warms in the same step. So this form
 * no longer posts coordinates, a ZIP, or a Chabad location — and this action
 * deliberately does not touch those columns, so saving a name never blanks
 * the shul's location.
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

  const supabase = await createClient();
  const { error } = await supabase.from("orgs").update({ name, timezone }).eq("id", org.orgId);

  if (error) {
    return { error: `That didn't save: ${error.message}. Check the fields and try again.` };
  }

  // The nav rail shows the org's name and every page under this layout reads
  // its own fresh copy of the row, so a rename or a timezone change should
  // not need a hard reload to show up.
  revalidatePath("/", "layout");

  return { saved: true };
}

export type SaveShulAddressState =
  | { status: "idle" }
  | { status: "failed"; message: string }
  | { status: "done"; label: string; message: string };

/**
 * The whole of setting a shul's location, from one address field — plan.md
 * §5c, and the settings page's only location control.
 *
 * ONE STEP, EVERYTHING IN THE BACKEND. A gabbai types an address and presses
 * "Use this address"; this geocodes it, saves the coordinates, ZIP and place
 * label to the org, and immediately warms Chabad zmanim for that ZIP. There
 * is no separate coordinate entry, no ZIP field, and no manual "Fetch now" —
 * they were front-end plumbing for what this does in the backend.
 *
 * US ONLY, for now. The zmanim feed is a US ZIP (lib/zmanim/chabad-rss.ts),
 * so a non-US result is refused here rather than saved as a location no
 * zmanim can be fetched for.
 *
 * SAVING IS NOT GATED ON THE ZMANIM FLAG. The coordinates and ZIP are facts
 * about the shul that the Hebrew-date, parsha and daf widgets need whether or
 * not Chabad.org is turned on (plan.md §3b), so they are always written; only
 * the warm is gated on ZMANIM_CHABAD_ENABLED, and the message says when it
 * was skipped.
 */
export async function saveShulAddress(query: string): Promise<SaveShulAddressState> {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "admin")) {
    return { status: "failed", message: "Only an owner or admin can change shul settings." };
  }

  const outcome = await geocodeAddress(query);
  if (!outcome.ok) return { status: "failed", message: outcome.message };

  const { label, latitude, longitude, postcode, countryCode } = outcome.place;

  // US only. The feed reads a US ZIP; a foreign address has no ZIP path, so
  // it is refused with a reason rather than saved as an unusable location.
  if (countryCode !== "us" || !postcode) {
    return {
      status: "failed",
      message: `“${label}” isn't a US address. The zmanim feed is US-only for now — enter a US address.`,
    };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase.from("orgs").select("timezone").eq("id", org.orgId).single();
  const timezone = existing?.timezone ?? "UTC";

  // Location is written; the label is the place the coordinates came from, for
  // the settings page to show back. The Chabad location columns for the
  // non-US city path are cleared so a stale city id can't shadow this ZIP.
  const { error } = await supabase
    .from("orgs")
    .update({
      latitude,
      longitude,
      postal_code: postcode,
      location_label: label,
      zmanim_location_id: null,
      zmanim_location_type: null,
      zmanim_location_name: null,
    })
    .eq("id", org.orgId);

  if (error) {
    return { status: "failed", message: `That didn't save: ${error.message}. Try again.` };
  }
  revalidatePath("/", "layout");

  // A candle-lighting sanity check the gabbai can actually judge, computed
  // from the coordinates just saved — the same load-bearing confirmation the
  // old lookup showed (a wrong place shows a visibly wrong time).
  const preview = previewCandleLighting({ latitude, longitude, timeZone: timezone });
  const lighting =
    preview.candleLighting && preview.candleLightingWhen
      ? ` Candle lighting there on ${preview.candleLightingWhen} is ${preview.candleLighting}.`
      : "";

  if (process.env.ZMANIM_CHABAD_ENABLED !== "true") {
    return {
      status: "done",
      label,
      message: `Saved ${label}.${lighting} Chabad.org isn't turned on for this deployment, so no zmanim were fetched.`,
    };
  }

  // Same function the cron calls (lib/zmanim/warm.ts) — one copy of the
  // service-role-keyed write, so the two can't drift.
  const location = resolveChabadLocation({ orgPostalCode: postcode });
  const warm = location ? await warmChabadLocation({ ...location, timezone }) : null;

  if (!warm || warm.status === "failed") {
    return {
      status: "done",
      label,
      message:
        `Saved ${label}.${lighting} But fetching zmanim failed` +
        `${warm && warm.status === "failed" ? `: ${warm.error}` : ""}. The daily fetch will try again.`,
    };
  }

  // What happens to the screens, said out loud: `zmanim_cache` is read at
  // BUILD time and frozen into each screen's bundle (lib/bundle/build.ts), so
  // a warm that queues no rebuild changes nothing in any lobby. "About five
  // minutes" is the build cron's own cadence (docs/environment.md).
  const screens =
    warm.screensQueued > 0
      ? ` ${warm.screensQueued} ${warm.screensQueued === 1 ? "screen" : "screens"} will pick it up within about five minutes.`
      : " No screen is waiting on it yet.";

  // The candle-lighting coverage is what the four-week embed reached. If that
  // leg failed, today's zmanim are cached but candle lighting isn't yet — say
  // so rather than reporting a clean success.
  const zmanim = warm.embedFailed
    ? "Fetched today's zmanim, but couldn't reach the candle-lighting list — the daily fetch will try again."
    : `Fetched today's zmanim and candle lighting for the next ${warm.candleLightingDates} ${
        warm.candleLightingDates === 1 ? "date" : "dates"
      }.`;

  return {
    status: "done",
    label,
    message: `Saved ${label}.${lighting} ${zmanim}${screens}`,
  };
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
