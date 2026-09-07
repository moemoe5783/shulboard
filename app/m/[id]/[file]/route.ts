import { NextResponse } from "next/server";
import { parseVariantFile, readAssetVariant } from "@/lib/bundle/media";
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
 */

export const dynamic = "force-dynamic";

function notFound() {
  return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function GET(_request: Request, { params }: RouteContext<"/m/[id]/[file]">) {
  const { id, file } = await params;

  const parsed = parseVariantFile(file);
  if (!parsed) return notFound();

  const db = serviceClientOrNull();
  if (!db) return notFound();

  const { data: asset } = await db
    .from("assets")
    .select("variants, deleted_at, storage_bucket")
    .eq("id", id)
    .maybeSingle();

  // Unknown and soft-deleted get the same answer — schema.md §6's deleted_at
  // is what makes an asset stop serving without anything else changing, and a
  // caller should not be able to tell "never existed" from "removed" here any
  // more than the bundle route lets one tell that apart for a screen token.
  if (!asset || asset.deleted_at) return notFound();

  const resolved = readAssetVariant(asset.variants, parsed.variant);

  // The hash and extension in the URL must match what is on file right now.
  if (!resolved || resolved.contentHash !== parsed.contentHash || resolved.extension !== parsed.extension) {
    return notFound();
  }

  const { data: blob, error } = await db.storage.from(asset.storage_bucket).download(resolved.storagePath);
  if (error || !blob) return notFound();

  return new NextResponse(blob, {
    headers: {
      "content-type": resolved.contentType,
      "content-length": String(blob.size),
      // Never `max-age` alone: `immutable` is what stops a browser from even
      // issuing a conditional revalidation, which a path that only ever names
      // one fixed set of bytes has no need to answer.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
