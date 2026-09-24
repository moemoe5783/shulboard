/*
 * A shul's plan — the three levels the platform admin sets
 * (supabase/migrations/20260926090000_platform_admin.sql). Client-safe, so a
 * form can list them; lib/platform.ts holds the server half.
 */

export const PLANS = ["trial", "basic", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export const PLAN_LABELS: Record<Plan, string> = {
  trial: "Free trial",
  basic: "Basic",
  pro: "Pro",
};

export function planLabel(plan: string): string {
  return (PLAN_LABELS as Record<string, string>)[plan] ?? plan;
}
