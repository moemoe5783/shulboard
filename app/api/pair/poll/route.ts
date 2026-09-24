import { NextResponse } from "next/server";
import { isDeviceSecret } from "@/lib/pairing";
import { hashDeviceSecret } from "@/lib/pairing-server";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * POST /api/pair/poll — the /pair page, every few seconds: "has someone
 * entered my code yet?"
 *
 * Service-role, like /api/pair/start (CLAUDE.md). Answers only about the
 * caller's own secret: once an admin has claimed its code (claim_pairing) and
 * the screen is still bound to that same secret, the TV gets the screen's link
 * token — and that token works only with this secret from then on
 * (lib/screen-token.ts), so it's no use to anyone who overhears it.
 *
 * Body: { secret }. Returns { status: "waiting" | "expired" } or
 * { status: "paired", token }.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = serviceClientOrNull();
  if (!db) return NextResponse.json({ error: "Pairing isn't configured yet.", code: "not_configured" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { secret?: unknown };
  if (!isDeviceSecret(body.secret)) {
    return NextResponse.json({ error: "Missing device secret.", code: "bad_request" }, { status: 400 });
  }
  const hash = hashDeviceSecret(body.secret);
  const headers = { "cache-control": "no-store" };

  // Already the TV of a screen (a claim that was delivered, or a screen
  // connected by link) — hand back its link again.
  const { data: screen } = await db
    .from("screens")
    .select("id, token, is_active")
    .eq("device_secret_hash", hash)
    .maybeSingle();
  if (screen?.is_active) {
    await db
      .from("pairing_requests")
      .update({ delivered_at: new Date().toISOString() })
      .eq("device_secret_hash", hash)
      .eq("claimed_screen_id", screen.id)
      .is("delivered_at", null);
    return NextResponse.json({ status: "paired", token: screen.token }, { headers });
  }

  const { data: latest } = await db
    .from("pairing_requests")
    .select("expires_at, claimed_at")
    .eq("device_secret_hash", hash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Claimed but no screen bound to this TV any more (disconnected since), or
  // simply out of time: the TV should ask for a fresh code.
  if (!latest || latest.claimed_at || new Date(latest.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ status: "expired" }, { headers });
  }
  return NextResponse.json({ status: "waiting" }, { headers });
}
