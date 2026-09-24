import { NextResponse } from "next/server";
import { deviceLabel, isDeviceSecret, PAIRING_MINUTES } from "@/lib/pairing";
import { hashDeviceSecret, newPairingCode } from "@/lib/pairing-server";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * POST /api/pair/start — a TV asks for a code to show (the /pair page).
 *
 * One of the places holding the service-role key (CLAUDE.md): the TV has no
 * session, and pairing_requests has no policies, by design. What makes it
 * safe to leave open: it only ever writes a row keyed by the caller's own
 * secret (kept as a hash) and hands back a code; nothing about any screen is
 * read or returned. Asking again with the same secret while its code is
 * still good returns the same code, so a reloaded page doesn't mint a new one.
 *
 * Body: { secret } — the TV's device secret (lib/pairing). Returns
 * { code, expiresAt }.
 */

export const dynamic = "force-dynamic";

/** Codes a single address may ask for in PAIRING_MINUTES — a building full of
 *  TVs being set up, not a script. */
const PER_ADDRESS = 30;

export async function POST(request: Request) {
  const db = serviceClientOrNull();
  if (!db) return NextResponse.json({ error: "Pairing isn't configured yet.", code: "not_configured" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { secret?: unknown };
  if (!isDeviceSecret(body.secret)) {
    return NextResponse.json({ error: "Missing device secret.", code: "bad_request" }, { status: 400 });
  }
  const hash = hashDeviceSecret(body.secret);
  const now = new Date();
  const from = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

  // Housekeeping: requests nobody claimed, a day past their expiry.
  await db
    .from("pairing_requests")
    .delete()
    .is("claimed_at", null)
    .lt("expires_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

  const { data: open } = await db
    .from("pairing_requests")
    .select("code, expires_at")
    .eq("device_secret_hash", hash)
    .is("claimed_at", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) return NextResponse.json({ code: open.code, expiresAt: open.expires_at }, { headers: { "cache-control": "no-store" } });

  if (from) {
    const since = new Date(now.getTime() - PAIRING_MINUTES * 60 * 1000).toISOString();
    const { count } = await db
      .from("pairing_requests")
      .select("id", { count: "exact", head: true })
      .eq("requested_from", from)
      .gt("created_at", since);
    if ((count ?? 0) >= PER_ADDRESS) {
      return NextResponse.json({ error: "Too many codes from here. Wait a few minutes.", code: "rate_limited" }, { status: 429, headers: { "retry-after": "120" } });
    }
  }

  const expiresAt = new Date(now.getTime() + PAIRING_MINUTES * 60 * 1000).toISOString();
  // A code is unique among the waiting ones; a clash (one in a million-ish
  // per waiting TV) just draws again.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newPairingCode();
    const { error } = await db.from("pairing_requests").insert({
      code,
      device_secret_hash: hash,
      device_label: deviceLabel(request.headers.get("user-agent")),
      requested_from: from,
      expires_at: expiresAt,
    });
    if (!error) return NextResponse.json({ code, expiresAt }, { headers: { "cache-control": "no-store" } });
    if (error.code !== "23505") break;
  }
  return NextResponse.json({ error: "Couldn't make a code. Try again.", code: "failed" }, { status: 502 });
}
