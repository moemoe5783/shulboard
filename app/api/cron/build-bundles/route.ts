import { NextResponse } from "next/server";
import { buildScreenBundle } from "@/lib/bundle/build";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * The build worker — docs/schema.md §10.
 *
 * Walks the rebuild queue: screens where `rebuild_requested_at is not null`,
 * oldest first, off the partial index. Invalidation is deliberately org-wide,
 * which is cheap regardless of how often this runs — a rebuild whose content
 * hash is unchanged updates `built_at` and stops, so over-invalidating never
 * costs a real rebuild, only a no-op query.
 *
 * HOW OFTEN THIS ACTUALLY RUNS IS A HOSTING DECISION, NOT ONE MADE HERE, AND
 * NOT ONE VISIBLE ANYWHERE IN THIS REPO. There is no Vercel cron entry —
 * a Vercel Hobby plan fails the whole deployment if a cron schedule fires
 * more than once daily, which is exactly the cadence a gabbai fixing a
 * davening time before Mincha needs. Scheduling is external instead: a
 * third-party scheduler (cron-job.org as of this writing) hits this route
 * every 5 minutes with `Authorization: Bearer <CRON_SECRET>`. See
 * docs/environment.md's CRON_SECRET section for exactly what that means and
 * what breaks if that external job is ever deleted without a replacement.
 * This route doesn't care who is calling it, only that the bearer token
 * matches.
 *
 * A ROUTE RATHER THAN A DAEMON because the deployment target is Vercel, where a
 * cron entry hits a URL. The work is in lib/bundle/build.ts so nothing about it
 * depends on that.
 *
 * GET, NOT POST. Vercel Cron always invokes the configured path with a GET
 * request — there is no way to make it send anything else. POST stays
 * exported too, for firing this by hand (curl, another scheduler) without
 * reaching for a browser bar; both run the identical, identically-guarded
 * handler below.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many screens one invocation will build. Bounded so a large org cannot
 *  make a single run exceed its wall-clock limit and lose the whole batch.
 *  At the external scheduler's 5-minute cadence this drains 120 screens an
 *  hour — fine today, a real ceiling at real scale. See docs/plan.md's build
 *  worker note for the arithmetic and when this is worth revisiting. */
const BATCH = 10;

async function handleBuildRequest(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const offered = request.headers.get("authorization");

  // No secret configured means the endpoint is closed, not open. An unguarded
  // build worker is an unauthenticated way to make the database do the most
  // expensive thing it does, repeatedly. Vercel sends this value itself, as
  // `Authorization: Bearer <CRON_SECRET>`, whenever the project has an
  // environment variable of exactly that name — see docs/environment.md.
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

export const GET = handleBuildRequest;
export const POST = handleBuildRequest;
