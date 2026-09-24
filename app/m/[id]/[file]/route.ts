import { NextResponse } from "next/server";
import { parseVariantFile, readAssetVariant } from "@/lib/bundle/media";
import { tagAssetResponse } from "@/lib/storage/cdn";
import { serviceClientOrNull } from "@/lib/supabase/service";

/*
 * GET /m/<asset_id>/<variant>-<hash>.<ext> — the media proxy, docs/plan.md §6.
 *
 * The only route that ever answers for an asset's bytes. A bundle never holds
 * a signed URL (lib/bundle/media.ts explains why: a signature carries an
 * expiry, the bundle is stored, and a screen that has not rebuilt would serve
 * dead image links while every part of the system reported healthy). Instead
 * it holds one of these paths, and this route is server-only, holding the
 * service role, for the same reason the bundle and heartbeat routes do:
 * Storage access here is authorized by the path being correct, not by RLS.
 *
 * IMMUTABLE BY CONSTRUCTION. The hash in the path is checked against what is
 * on file for that variant right now — not compared for "close enough," but
 * for exact equality — so `Cache-Control: immutable` is never a lie. A
 * mismatch means the asset was reprocessed and this path names bytes that no
 * longer exist, not bytes that merely went stale; the caller gets the same
 * 404 either way.
 *
 * CACHED AT VERCEL'S EDGE, not only in the browser. `Cache-Control` alone
 * speaks to the browser and the TV's service worker; `CDN-Cache-Control` and
 * `Vercel-CDN-Cache-Control` tell Vercel's CDN to keep the file too, so a
 * second screen asking for the same photo is answered at the edge instead of
 * by this function reading Storage again. (`force-dynamic` only makes the
 * handler run per request rather than at build time; the CDN still caches
 * what these headers allow.) Each response is tagged with the photo's id
 * (lib/storage/cdn.ts) so a permanent delete can purge it.
 *
 * A 404 is cached for a minute, never longer: long enough to spare Storage a
 * burst of requests for a deleted photo, short enough that nothing is stuck
 * "missing" for long. A ready photo's URL can't meet a 404 first — a URL only
 * exists once its row is ready (lib/media/upload.ts) — and a Storage hiccup
 * is a 503 that is never cached, not a 404.
 */

export const dynamic = "force-dynamic";

/** A year: the path names these bytes forever. */
const FOREVER = 31536000;
/** A minute, for a 404 (see above). */
const NOT_FOUND_TTL = 60;

function notFound() {
  return new NextResponse(null, {
    status: 404,
    headers: {
      "cache-control": `public, max-age=${NOT_FOUND_TTL}`,
      "cdn-cache-control": `max-age=${NOT_FOUND_TTL}`,
      "vercel-cdn-cache-control": `max-age=${NOT_FOUND_TTL}`,
    },
  });
}

/** Storage didn't answer — try again, and never remember this. */
function unavailable() {
  return new NextResponse(null, { status: 503, headers: { "cache-control": "no-store" } });
}

export async function GET(_request: Request, { params }: RouteContext<"/m/[id]/[file]">) {
  const { id, file } = await params;

  const parsed = parseVariantFile(file);
  if (!parsed) return notFound();

  const db = serviceClientOrNull();
  if (!db) return unavailable();

  const { data: asset, error: lookupError } = await db
    .from("assets")
    .select("variants, deleted_at, status, storage_bucket")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) return unavailable();

  // Unknown and soft-deleted get the same answer — schema.md §6's deleted_at
  // is what makes an asset stop serving without anything else changing, and a
  // caller should not be able to tell "never existed" from "removed" here any
  // more than the bundle route lets one tell that apart for a screen token.
  if (!asset || asset.deleted_at) return notFound();
  // An upload still in progress, or one that failed, has no complete set of
  // files to serve (lib/media/upload.ts).
  if (asset.status !== "ready") return notFound();

  const resolved = readAssetVariant(asset.variants, parsed.variant);

  // The hash and extension in the URL must match what is on file right now.
  if (!resolved || resolved.contentHash !== parsed.contentHash || resolved.extension !== parsed.extension) {
    return notFound();
  }

  const { data: blob, error } = await db.storage.from(asset.storage_bucket).download(resolved.storagePath);
  if (error || !blob) return unavailable();

  await tagAssetResponse(id);
  return new NextResponse(blob, {
    headers: {
      "content-type": resolved.contentType,
      "content-length": String(blob.size),
      // Never `max-age` alone: `immutable` is what stops a browser from even
      // issuing a conditional revalidation, which a path that only ever names
      // one fixed set of bytes has no need to answer.
      "cache-control": `public, max-age=${FOREVER}, immutable`,
      "cdn-cache-control": `max-age=${FOREVER}`,
      "vercel-cdn-cache-control": `max-age=${FOREVER}`,
    },
  });
}
