import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";
import { requireUser } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";

/*
 * The platform admin — the people who run Shulboard itself
 * (supabase/migrations/20260926090000_platform_admin.sql). Asked of the
 * database, under the signed-in user's own session: the answer includes
 * two-step sign-in, so an admin with an authenticator app on and a
 * password-only session is, correctly, not one yet.
 */

export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  return !error && data === true;
});

/** For the admin pages: anyone else gets a plain not-found, not a hint that
 *  there's something here. */
export async function requirePlatformAdmin(): Promise<void> {
  await requireUser();
  if (!(await isPlatformAdmin())) notFound();
}

export { PLAN_LABELS, PLANS, planLabel, type Plan } from "./plans";

/** "4.2 GB", "310 MB", "0 bytes". */
export function formatBytes(bytes: number): string {
  if (!bytes) return "0 bytes";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "";
