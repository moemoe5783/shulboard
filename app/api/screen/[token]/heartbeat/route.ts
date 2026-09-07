import { NextResponse } from "next/server";
import type { HeartbeatBody } from "@/lib/bundle/types";
import { resolveScreenToken } from "@/lib/screen-token";
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

  // Same answer as the bundle route, for the same reason: a client-writable
  // heartbeat would let anyone forge liveness for any screen, so an unknown or
  // rotated token — or a lookup that failed outright — gets nothing.
  const result = await resolveScreenToken(db, token);
  if (!result.ok) {
    return NextResponse.json({ ok: false, code: "token_invalid" }, { status: 410 });
  }
  const screen = result.screen;

  let body: HeartbeatBody = {};
  try {
    body = (await request.json()) as HeartbeatBody;
  } catch {
    // A beat with no body is still a beat. The point of this route is liveness;
    // the diagnostics are a bonus and must never cost us the signal.
  }

  // Every one of these is `default null` in the SQL function, so omitting the
  // key and sending an explicit JSON null reach Postgres identically — but
  // the generated RPC args type says "omit" (`?: T`), not "or null", so
  // `undefined` is what satisfies it without changing what gets sent.
  const { error } = await db.rpc("record_heartbeat", {
    p_screen_id: screen.id,
    p_org_id: screen.org_id,
    p_bundle_version: body.bundleVersion ?? undefined,
    p_board_id: body.boardId ?? undefined,
    p_app_version: body.appVersion ?? undefined,
    p_user_agent: request.headers.get("user-agent") ?? undefined,
    p_viewport_width: body.viewportWidth ?? undefined,
    p_viewport_height: body.viewportHeight ?? undefined,
    p_uptime_seconds: body.uptimeSeconds ?? undefined,
    p_error_count: body.errorCount ?? 0,
    p_last_error: body.lastError ?? undefined,
  });

  if (error) return NextResponse.json({ ok: false }, { status: 502 });

  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
