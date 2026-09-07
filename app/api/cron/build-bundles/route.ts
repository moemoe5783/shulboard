import { NextResponse } from "next/server";
import { buildScreenBundle } from "@/lib/bundle/build";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * The build worker — docs/schema.md §10.
 *
 * Walks the rebuild queue: screens where `rebuild_requested_at is not null`,
 * oldest first, off the partial index. Invalidation is deliberately org-wide, so
 * this runs often and mostly produces no-ops — a rebuild whose content hash is
 * unchanged updates `built_at` and stops, which is what makes over-invalidation
 * cheap at the display.
 *
 * A ROUTE RATHER THAN A DAEMON because the deployment target is Vercel, where a
 * cron entry hits a URL. The work is in lib/bundle/build.ts so nothing about it
 * depends on that.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many screens one invocation will build. Bounded so a large org cannot
 *  make a single run exceed its wall-clock limit and lose the whole batch. */
const BATCH = 10;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const offered = request.headers.get("authorization");

  // No secret configured means the endpoint is closed, not open. An unguarded
  // build worker is an unauthenticated way to make the database do the most
  // expensive thing it does, repeatedly.
  if (!secret || offered !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  const db = serviceClientOrNull();
  if (!db) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const { data: queued, error } = await db
    .from("screens")
    .select("id")
    .not("rebuild_requested_at", "is", null)
    .eq("is_active", true)
    // Back-off: a screen that has failed repeatedly stops crowding out the ones
    // that would succeed. §10 leaves the flag set on failure precisely so this
    // ordering, not the flag, decides when to try again.
    .order("rebuild_attempts", { ascending: true })
    .order("rebuild_requested_at", { ascending: true })
    .limit(BATCH);

  if (error) return NextResponse.json({ error: error.message }, { status: 502 });

  const results = [];
  for (const screen of queued ?? []) {
    // Serially. Each build resolves 90 days of zmanim and 60 days of
    // anniversaries; ten at once is how one shul's edit becomes everyone's
    // slow afternoon. §10's note about the queue is about exactly this.
    results.push(await buildScreenBundle(screen.id));
  }

  return NextResponse.json({
    considered: queued?.length ?? 0,
    built: results.filter((r) => r.status === "built").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
