import { NextResponse } from "next/server";
import { etagFor, etagMatches } from "@/lib/bundle/hash";
import type { BundleEnvelope } from "@/lib/bundle/types";
import { resolveScreenToken } from "@/lib/screen-token";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * GET /api/screen/[token]/bundle — docs/plan.md §3a.
 *
 * The display's only data endpoint, and the only place in the product besides
 * its two siblings that holds the service-role key. It reads `screen_bundles`
 * and never builds anything: the build is a background job, so a screen polling
 * every sixty seconds costs one indexed lookup and, almost always, a 304.
 *
 * THE 304 PATH MUST NOT READ `payload`. A poll carrying If-None-Match needs
 * only `version` and `content_hash`. Postgres stores a large payload out of line
 * in TOAST, so selecting just those two columns never detoasts or decompresses
 * the big one. A `select *` here looks identical and would make every 60-second
 * poll from every screen in the product pay a full bundle read to answer "no
 * change" — the difference between a trivial query and the most expensive one in
 * the system.
 */

export const dynamic = "force-dynamic";

/**
 * A token that names no live screen.
 *
 * 410 rather than 404, and the same answer for "never existed" as for "rotated
 * away": from the device's side those are one fact, and distinguishing them
 * would tell anyone holding a guess whether it was ever a real token.
 *
 * This is where token rotation actually takes effect (§3a). The display is
 * storage-first and cannot enforce rotation on itself; the server is the only
 * thing that can say no, and the display's answer to this status is to clear its
 * stored token and fall back to whatever the URL carries.
 */
function gone() {
  return NextResponse.json(
    { error: "This screen link is no longer valid.", code: "token_invalid" },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request, { params }: RouteContext<"/api/screen/[token]/bundle">) {
  const { token } = await params;

  const db = serviceClientOrNull();
  if (!db) {
    return NextResponse.json(
      { error: "This screen isn't configured yet.", code: "not_configured" },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "300" } },
    );
  }

  const result = await resolveScreenToken(db, token);

  if (!result.ok && result.reason === "lookup_failed") {
    return NextResponse.json(
      { error: "Couldn't reach the board.", code: "lookup_failed" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  // A rotated token no longer matches any row, so "not found" and "rotated" are
  // the same branch. A deactivated screen is revocation without deletion.
  if (!result.ok) return gone();

  const screen = result.screen;

  const ifNoneMatch = request.headers.get("if-none-match");

  if (ifNoneMatch) {
    const { data: head } = await db
      .from("screen_bundles")
      .select("version, content_hash")
      .eq("screen_id", screen.id)
      .maybeSingle();

    if (head && etagMatches(ifNoneMatch, head.content_hash)) {
      // No body, and no payload was read to decide that.
      return new NextResponse(null, {
        status: 304,
        headers: {
          etag: etagFor(head.content_hash),
          "cache-control": "no-cache",
        },
      });
    }
  }

  const { data: bundle } = await db
    .from("screen_bundles")
    .select("version, content_hash, payload, ttl_seconds, built_at")
    .eq("screen_id", screen.id)
    .maybeSingle();

  if (!bundle) {
    // The screen is real; its first build has not landed yet. Not an error the
    // device should give up on — it has last-known-good or it has nothing, and
    // either way it should come back.
    return NextResponse.json(
      { error: "This screen's board hasn't been built yet.", code: "not_built" },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "60" } },
    );
  }

  const envelope: BundleEnvelope = {
    ...(bundle.payload as BundleEnvelope),
    bundleVersion: bundle.version,
    contentHash: bundle.content_hash,
    builtAt: bundle.built_at,
    ttlSeconds: bundle.ttl_seconds,
  };

  return NextResponse.json(envelope, {
    headers: {
      etag: etagFor(bundle.content_hash),
      // must-revalidate, not a max-age: the display decides when to poll (§3d),
      // and an intermediary holding this for even a minute would make "publish
      // now" mean "publish soon".
      "cache-control": "no-cache, must-revalidate",
    },
  });
}
