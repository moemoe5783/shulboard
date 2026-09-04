"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ACTIVE_ORG_COOKIE, getMemberships, requireUser } from "@/lib/orgs";
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
      .insert({ name, slug, timezone, created_by: user.id });

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
