"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE } from "@/lib/orgs";
import { SIGN_IN_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export type AcceptState = { error?: string };

/** Join the shul (accept_org_invite checks everything), then open it. */
export async function acceptInvite(_previous: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_org_invite", { p_token: token });
  if (error || !orgId) {
    const message = error?.message ?? "";
    if (/different email/i.test(message)) return { error: "This invitation is for a different email address." };
    if (/expired/i.test(message)) return { error: "This invitation has expired. Ask for a new one." };
    if (/withdrawn|already used|does not exist/i.test(message)) return { error: "This invitation can't be used any more. Ask for a new one." };
    return { error: `That didn't work: ${message || "no shul came back"}.` };
  }
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  redirect("/");
}

/** Signed in as the wrong account: sign out and come back here to sign in as the right one. */
export async function switchAccount(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const email = String(formData.get("email") ?? "");
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ACTIVE_ORG_COOKIE);
  const params = new URLSearchParams({ from: `/invite/${token}`, email });
  redirect(`${SIGN_IN_PATH}?${params}`);
}
