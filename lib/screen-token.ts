import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isDeviceSecret } from "@/lib/pairing";
import { hashDeviceSecret } from "@/lib/pairing-server";

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
  // The screen is connected to a different TV. One TV per screen
  // (20260925090200_screen_pairing.sql): a copied link doesn't put the board on
  // a second one.
  | { ok: false; reason: "other_device" }
  // The database itself could not answer. Distinct from "not_found" because a
  // caller may want to say so rather than telling a working screen its link is
  // dead.
  | { ok: false; reason: "lookup_failed" };

/**
 * `deviceSecret` is the TV's own secret, from the DEVICE_HEADER (lib/pairing).
 * A screen bound to a TV answers only that TV. A screen not bound yet (set up
 * by link before pairing existed) becomes bound to the first device that
 * presents a secret with its link — the TV on the wall, polling around the
 * clock — and from then on the same rule holds. A request with no secret at
 * all (a display still running code from before this) is let through for an
 * unbound screen only.
 */
export async function resolveScreenToken(
  db: SupabaseClient<Database>,
  token: string,
  deviceSecret?: string | null,
): Promise<ScreenTokenResult> {
  const { data, error } = await db
    .from("screens")
    .select("id, org_id, is_active, device_secret_hash")
    .eq("token", token)
    .maybeSingle();

  if (error) return { ok: false, reason: "lookup_failed" };
  if (!data || data.is_active === false) return { ok: false, reason: "not_found" };
  const screen = { id: data.id as string, org_id: data.org_id as string };

  const presented = isDeviceSecret(deviceSecret) ? hashDeviceSecret(deviceSecret) : null;
  if (data.device_secret_hash) {
    return presented === data.device_secret_hash ? { ok: true, screen } : { ok: false, reason: "other_device" };
  }
  if (!presented) return { ok: true, screen };

  // Bind, but only if nothing else bound it first — the filter on
  // device_secret_hash makes a race between two devices a single winner.
  const { data: bound, error: bindError } = await db
    .from("screens")
    .update({ device_secret_hash: presented, device_label: "Connected by link", device_paired_at: new Date().toISOString() })
    .eq("id", screen.id)
    .is("device_secret_hash", null)
    .select("device_secret_hash");
  if (bindError) {
    // The same TV already bound to another screen (the unique index), or the
    // database is unreachable. Either way this device isn't this screen's TV.
    return bindError.code === "23505" ? { ok: false, reason: "other_device" } : { ok: false, reason: "lookup_failed" };
  }
  if (bound && bound.length > 0) return { ok: true, screen };
  // Lost the race: whoever won is the TV.
  const { data: now } = await db.from("screens").select("device_secret_hash").eq("id", screen.id).maybeSingle();
  return now?.device_secret_hash === presented ? { ok: true, screen } : { ok: false, reason: "other_device" };
}
