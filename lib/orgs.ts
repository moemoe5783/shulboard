import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { SIGN_IN_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * The current user's orgs and roles.
 *
 * Every protected page goes through here. Nothing in this file uses the service
 * role or bypasses a policy: the queries below return what RLS lets this user
 * see, which is the same thing the page is allowed to render. If a query here
 * ever comes back empty when it should not, the bug is in a policy, not here.
 */

export type OrgRole = "owner" | "admin" | "editor" | "viewer";

export type Membership = {
  orgId: string;
  name: string;
  slug: string;
  timezone: string;
  role: OrgRole;
};

/** The cookie holding which org the user last looked at. */
export const ACTIVE_ORG_COOKIE = "shulboard_org";

/** Cached per request, so a layout and its page share one round trip. */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await getUser();
  if (!user) return [];

  const supabase = await createClient();

  // Filtered to this user's own rows. The org_members policy lets a member see
  // everyone in their orgs, which is correct for a members list and wrong for
  // "which orgs am I in" — so the filter is here, not in the policy.
  const { data, error } = await supabase
    .from("org_members")
    .select("role, orgs(id, name, slug, timezone)")
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Could not load your shuls: ${error.message}`);
  }

  type Row = {
    role: OrgRole;
    orgs: { id: string; name: string; slug: string; timezone: string } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((row): row is Row & { orgs: NonNullable<Row["orgs"]> } => row.orgs !== null)
    .map((row) => ({
      orgId: row.orgs.id,
      name: row.orgs.name,
      slug: row.orgs.slug,
      timezone: row.orgs.timezone,
      role: row.role,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

/**
 * The org the user is looking at.
 *
 * The cookie is a preference, not an authorisation: the value is only honoured
 * when it appears in the memberships RLS already returned, so a hand-edited
 * cookie selects nothing rather than another shul.
 */
export const getActiveOrg = cache(async (): Promise<Membership | null> => {
  const memberships = await getMemberships();
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  return memberships.find((m) => m.orgId === preferred) ?? memberships[0];
});

/** For pages that cannot render without a session. The proxy is the first
 * line; this is the one that runs even if a matcher is edited badly. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect(SIGN_IN_PATH);
  return user;
}

/** For pages that cannot render without an org. Sends a brand new user to the
 * one step that comes before everything else. */
export async function requireActiveOrg(): Promise<Membership> {
  await requireUser();
  const org = await getActiveOrg();
  if (!org) redirect("/orgs/new");
  return org;
}

const RANK: Record<OrgRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

/** Mirrors has_org_role_at_least() in the database. This one decides what to
 * render; the policy decides what the query returns. Both have to agree, and the
 * database is the one that actually enforces it. */
export function hasRoleAtLeast(role: OrgRole, minimum: OrgRole): boolean {
  return RANK[role] >= RANK[minimum];
}
