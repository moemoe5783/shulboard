"use server";

import { revalidatePath } from "next/cache";
import { PLANS, requirePlatformAdmin, type Plan } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";

/*
 * The platform admin's two writes. Each goes through its SECURITY DEFINER
 * function (supabase/migrations/20260926090000_platform_admin.sql), which
 * checks the caller is a platform admin itself — the check here is so a
 * non-admin gets a sentence rather than a Postgres error.
 */

export type SetPlanState = { error?: string; saved?: string; at?: number };

export async function setOrgPlan(_previous: SetPlanState, formData: FormData): Promise<SetPlanState> {
  await requirePlatformAdmin();
  const orgId = String(formData.get("orgId") ?? "");
  const plan = String(formData.get("plan") ?? "") as Plan;
  const trialEnds = String(formData.get("trialEnds") ?? "").trim();
  if (!PLANS.includes(plan)) return { error: "Choose a plan." };
  if (plan === "trial" && trialEnds && !/^\d{4}-\d{2}-\d{2}$/.test(trialEnds)) return { error: "That trial end date isn't a date." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_org_plan", {
    p_org: orgId,
    p_plan: plan,
    // The end of that day, so a trial "ending 1 Nov" runs through 1 Nov. Null
    // (no end, or not a trial) is valid; the generated types don't know a
    // function argument can be.
    p_trial_ends_at: (plan === "trial" && trialEnds ? `${trialEnds}T23:59:59Z` : null) as string,
  });
  if (error) return { error: `That didn't save: ${error.message}.` };
  revalidatePath("/admin");
  revalidatePath(`/admin/shuls/${orgId}`);
  return { saved: "Saved", at: Date.now() };
}

export async function setPlatformAdmin(userId: string, admin: boolean): Promise<{ error?: string }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_admin", { p_user: userId, p_admin: admin });
  if (error) {
    if (/remove yourself/i.test(error.message)) return { error: "You can't remove yourself. Another platform admin can." };
    return { error: `That didn't save: ${error.message}.` };
  }
  revalidatePath("/admin/accounts");
  return {};
}
