"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { inviteEmail } from "@/lib/email/templates";
import { ACTIVE_ORG_COOKIE, hasRoleAtLeast, requireActiveOrg, requireUser, type OrgRole } from "@/lib/orgs";
import { requestOrigin } from "@/lib/origin";
import { INVITE_PATH_PREFIX } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/*
 * Who's in the shul, and who's been asked to join (plan.md §8).
 *
 * Every write goes through RLS with the signed-in user's own session: the
 * policies say only an admin or owner manages members and invites, and the
 * org_members guard trigger adds the rest (only an owner touches an owner,
 * nobody changes their own role, the last owner can't leave). The checks here
 * come first only so the answer is a sentence rather than a Postgres error.
 */

const INVITE_DAYS = 14;
const INVITABLE: OrgRole[] = ["viewer", "editor", "admin"];

export type InviteState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; email: string; sent: boolean; link: string; note?: string };

function inviteLink(origin: string, token: string): string {
  return `${origin}${INVITE_PATH_PREFIX}${token}`;
}

async function sendInvite(input: { email: string; role: string; token: string; expiresAt: Date; shulName: string }) {
  const user = await requireUser();
  const inviterName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) || user.email || "Someone";
  const link = inviteLink(await requestOrigin(), input.token);
  const { subject, content } = inviteEmail({
    shulName: input.shulName,
    inviterName,
    role: input.role,
    acceptUrl: link,
    expiresOn: input.expiresAt.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }),
  });
  const outcome = await sendEmail({ to: input.email, subject, content });
  return { link, outcome };
}

export async function inviteMember(_previous: InviteState, formData: FormData): Promise<InviteState> {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "admin")) return { status: "error", message: "Only an owner or admin can invite people." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "editor") as OrgRole;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: "error", message: "Enter an email address, like gabbai@example.com." };
  if (!INVITABLE.includes(role)) return { status: "error", message: "Pick what they can do." };

  const supabase = await createClient();
  const { data: members } = await supabase.rpc("org_member_directory", { p_org: org.orgId });
  if ((members ?? []).some((member) => member.email?.toLowerCase() === email)) {
    return { status: "error", message: `${email} is already in ${org.name}.` };
  }

  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);

  // One live invite per address: asking again re-sends it with a fresh expiry
  // (and the newly chosen role) rather than failing on the unique index.
  const { data: existing } = await supabase
    .from("org_invites")
    .select("id, token")
    .eq("org_id", org.orgId)
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();

  let token: string;
  if (existing) {
    token = existing.token;
    const { error } = await supabase
      .from("org_invites")
      .update({ role, expires_at: expiresAt.toISOString() })
      .eq("id", existing.id);
    if (error) return { status: "error", message: `That didn't save: ${error.message}.` };
  } else {
    // 24 random bytes: the token is the whole credential for invite_preview.
    token = randomBytes(24).toString("base64url");
    const { error } = await supabase
      .from("org_invites")
      .insert({ org_id: org.orgId, email, role, token, expires_at: expiresAt.toISOString() });
    if (error) return { status: "error", message: `That didn't save: ${error.message}.` };
  }

  const { link, outcome } = await sendInvite({ email, role, token, expiresAt, shulName: org.name });
  revalidatePath("/settings/members");
  return {
    status: "done",
    email,
    sent: outcome.sent,
    link,
    note: outcome.sent
      ? undefined
      : isEmailConfigured()
        ? `The email didn't go out — ${outcome.reason} Copy the link below and send it yourself.`
        : "Email isn't set up on this deployment yet, so copy the link below and send it yourself.",
  };
}

export async function resendInvite(inviteId: string): Promise<{ ok: boolean; message: string }> {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "admin")) return { ok: false, message: "Only an owner or admin can do that." };
  const supabase = await createClient();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("org_invites")
    .update({ expires_at: expiresAt.toISOString() })
    .eq("id", inviteId)
    .eq("org_id", org.orgId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("email, role, token")
    .maybeSingle();
  if (error || !data) return { ok: false, message: "That invitation isn't waiting any more." };
  const { outcome } = await sendInvite({ ...data, expiresAt, shulName: org.name });
  revalidatePath("/settings/members");
  return outcome.sent
    ? { ok: true, message: `Sent again to ${data.email}.` }
    : { ok: false, message: `It didn't send — ${outcome.reason} Copy the link instead.` };
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "admin")) return;
  const supabase = await createClient();
  await supabase
    .from("org_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("org_id", org.orgId);
  revalidatePath("/settings/members");
}

function memberError(message: string): string {
  if (/only an owner may/i.test(message)) return "Only an owner can change or remove an owner.";
  if (/your own role/i.test(message)) return "You can't change your own role. Ask another admin or owner.";
  if (/at least one owner/i.test(message)) return "A shul needs at least one owner. Make someone else an owner first.";
  return `That didn't save: ${message}.`;
}

export async function changeMemberRole(userId: string, role: OrgRole): Promise<{ error?: string }> {
  const org = await requireActiveOrg();
  if (!hasRoleAtLeast(org.role, "admin")) return { error: "Only an owner or admin can change what people can do." };
  if (role === "owner" && org.role !== "owner") return { error: "Only an owner can make someone an owner." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_members")
    .update({ role })
    .eq("org_id", org.orgId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return { error: memberError(error.message) };
  if (!data?.length) return { error: "That didn't save. Reload the page and try again." };
  revalidatePath("/settings/members");
  return {};
}

export async function removeMember(userId: string): Promise<{ error?: string }> {
  const org = await requireActiveOrg();
  const user = await requireUser();
  const leaving = userId === user.id;
  if (!leaving && !hasRoleAtLeast(org.role, "admin")) return { error: "Only an owner or admin can remove people." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", org.orgId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return { error: memberError(error.message) };
  if (!data?.length) return { error: "That didn't save. Reload the page and try again." };
  if (leaving) {
    (await cookies()).delete(ACTIVE_ORG_COOKIE);
    revalidatePath("/", "layout");
    redirect("/");
  }
  revalidatePath("/settings/members");
  return {};
}
