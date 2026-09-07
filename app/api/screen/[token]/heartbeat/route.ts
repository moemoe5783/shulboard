import { NextResponse } from "next/server";
import type { HeartbeatBody } from "@/lib/bundle/types";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * POST /api/screen/[token]/heartbeat — docs/plan.md §3e.
 *
 * "Shuls will call you about black screens; you need this." Every 60 seconds a
 * screen says it is alive and what it is running, and the dashboard turns that
 * into one green dot per room.
 *
 * The work happens in a SQL function, not here. `beat_count` accumulates,
 * `error_count` accumulates, `max_gap_seconds` takes a maximum, and everything
 * else is last-write-wins within the hour — an upsert expressed through
 * PostgREST would overwrite the counters instead of incrementing them, which
 * looks correct and silently makes the whole table say 1.
 */

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/screen/[token]/heartbeat">,
) {
  const { token } = await params;

  const db = serviceClientOrNull();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });

  const { data: screen } = await db
    .from("screens")
    .select("id, org_id, is_active")
    .eq("token", token)
    .maybeSingle();

  // Same answer as the bundle route, for the same reason: a client-writable
  // heartbeat would let anyone forge liveness for any screen, so an unknown or
  // rotated token gets nothing.
  if (!screen || screen.is_active === false) {
    return NextResponse.json({ ok: false, code: "token_invalid" }, { status: 410 });
  }

  let body: HeartbeatBody = {};
  try {
    body = (await request.json()) as HeartbeatBody;
  } catch {
    // A beat with no body is still a beat. The point of this route is liveness;
    // the diagnostics are a bonus and must never cost us the signal.
  }

  const { error } = await db.rpc("record_heartbeat", {
    p_screen_id: screen.id,
    p_org_id: screen.org_id,
    p_bundle_version: body.bundleVersion ?? null,
    p_board_id: body.boardId ?? null,
    p_app_version: body.appVersion ?? null,
    p_user_agent: request.headers.get("user-agent"),
    p_viewport_width: body.viewportWidth ?? null,
    p_viewport_height: body.viewportHeight ?? null,
    p_uptime_seconds: body.uptimeSeconds ?? null,
    p_error_count: body.errorCount ?? 0,
    p_last_error: body.lastError ?? null,
  });

  if (error) return NextResponse.json({ ok: false }, { status: 502 });

  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
