"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ACTIVE_ORG_COOKIE, getMemberships, hasRoleAtLeast, requireActiveOrg, requireUser } from "@/lib/orgs";
import { SIGN_IN_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

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
      .insert({ name, slug, timezone, latitude, longitude, created_by: user.id });

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

export type UpdateOrgSettingsState = { error?: string; saved?: boolean };

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

  const supabase = await createClient();
  const { error } = await supabase
    .from("orgs")
    .update({ name, timezone, latitude, longitude })
    .eq("id", org.orgId);

  if (error) {
    return { error: `That didn't save: ${error.message}. Check the fields and try again.` };
  }

  // The nav rail shows the org's name and every page under this layout reads
  // its own fresh copy of the row, so a rename or a timezone change should
  // not need a hard reload to show up.
  revalidatePath("/", "layout");
  return { saved: true };
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
