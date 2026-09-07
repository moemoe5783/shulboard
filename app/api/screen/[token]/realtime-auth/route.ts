import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import { resolveScreenToken } from "@/lib/screen-token";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * POST /api/screen/[token]/realtime-auth — the display's only Realtime
 * credential.
 *
 * lib/display/realtime.ts subscribes to `screen:<id>` with the anon key, which
 * is public and identical for every screen in the product. Without this route
 * that channel is unauthorized: any anonymous client can subscribe to any
 * screen's channel, and the only thing stopping it from mattering is that a
 * forged `bundle_changed` just costs a wasted 304. This route is the
 * compensating control, closing that hole the way §3a's token check closes the
 * equivalent one on the bundle route.
 *
 * It re-validates the screen token exactly as the bundle and heartbeat routes
 * do, then mints a short-lived JWT carrying that one screen's id as a claim.
 * The Realtime authorization policy in
 * supabase/migrations/20260908090000_realtime_channel_authorization.sql lets a
 * client subscribe to `screen:<id>` only if its JWT names that id.
 *
 * NOT A SESSION. There is no Supabase Auth user behind this token, no `sub`
 * claim, nothing persisted server-side — it exists only so Realtime's RLS
 * check on realtime.messages has a claim to read. The display re-fetches one
 * before every subscribe and again periodically for as long as it stays
 * connected (lib/display/realtime.ts); nothing here needs to live longer than
 * that.
 */

export const dynamic = "force-dynamic";

const TOKEN_TTL_SECONDS = 5 * 60;

function jwtSigningKey(): Uint8Array | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  return secret ? new TextEncoder().encode(secret) : null;
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/screen/[token]/realtime-auth">,
) {
  const { token } = await params;

  const db = serviceClientOrNull();
  const key = jwtSigningKey();
  if (!db || !key) {
    return NextResponse.json(
      { error: "Realtime isn't configured for this screen.", code: "not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const result = await resolveScreenToken(db, token);
  if (!result.ok) {
    return NextResponse.json(
      { error: "This screen link is no longer valid.", code: "token_invalid" },
      { status: 410, headers: { "cache-control": "no-store" } },
    );
  }

  // role: authenticated so the realtime.messages policy's `to authenticated`
  // clause applies. screen_id is the only claim that policy reads — this token
  // grants nothing else, on any table.
  const jwt = await new SignJWT({ role: "authenticated", screen_id: result.screen.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(key);

  return NextResponse.json(
    { token: jwt, expiresIn: TOKEN_TTL_SECONDS },
    { headers: { "cache-control": "no-store" } },
  );
}
