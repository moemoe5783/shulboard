import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Resolving a screen's display token to the screen it names.
 *
 * The one lookup shared by every server route a screen calls directly: the
 * bundle, the heartbeat, and realtime authorization. All three need the same
 * answer to "is this token still good" for the same reason (§3a) — an unknown
 * token and a rotated-away one are one fact, not two, so a client cannot tell
 * a screen that never existed from one whose link changed underneath it. That
 * belongs in one function, not three copies quietly drifting apart.
 */

export type ScreenByToken = { id: string; org_id: string };

export type ScreenTokenResult =
  | { ok: true; screen: ScreenByToken }
  // The token names no live screen — unknown and rotated-away are the same.
  | { ok: false; reason: "not_found" }
  // The database itself could not answer. Distinct from "not_found" because a
  // caller may want to say so rather than telling a working screen its link is
  // dead.
  | { ok: false; reason: "lookup_failed" };

export async function resolveScreenToken(
  db: SupabaseClient,
  token: string,
): Promise<ScreenTokenResult> {
  const { data, error } = await db
    .from("screens")
    .select("id, org_id, is_active")
    .eq("token", token)
    .maybeSingle();

  if (error) return { ok: false, reason: "lookup_failed" };
  if (!data || data.is_active === false) return { ok: false, reason: "not_found" };
  return { ok: true, screen: { id: data.id as string, org_id: data.org_id as string } };
}
