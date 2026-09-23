"use client";

import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_IMAGE_TYPES,
  BOARD_VARIANT,
  scaledSize,
  VARIANT_CONTENT_TYPE,
  VARIANT_EXTENSION,
  VARIANT_QUALITY,
  VARIANT_SPECS,
} from "./variants";

/*
 * The browser-side upload pipeline (v1, image-only, no HEIC).
 *
 * For each photo: decode it (auto-oriented from its EXIF), resize to each
 * variant, re-encode to WebP (which drops EXIF/GPS), upload the derivatives to
 * the `assets` Storage bucket under <org>/<asset>/<variant>-<hash>.webp, and
 * write the `assets` row plus an `album_items` link — exactly the shape
 * lib/bundle/media.ts and the /m proxy already read.
 *
 * DEDUP BY CHECKSUM. The same photo uploaded twice (schema's
 * (org_id, checksum_sha256) unique index) reuses the existing asset and only
 * adds an album link — "one row serves all," the same principle the zmanim
 * cache and the bundle's per-asset fetch rest on.
 *
 * Everything runs against the authenticated browser client, so Storage and
 * table writes are gated by the RLS this project keys on org membership — no
 * service role anywhere near an upload.
 */

export type UploadResult = { ok: true; assetId: string; deduped: boolean } | { ok: false; error: string };

/** Where one photo's upload has got to, for the album page's progress tiles.
 *  `fraction` runs 0..1 across the whole upload of this photo. */
export type UploadStage = "reading" | "resizing" | "uploading" | "saving";
export type UploadProgress = (stage: UploadStage, fraction: number) => void;

type VariantEntry = {
  storage_path: string;
  content_hash: string;
  extension: string;
  content_type: string;
  bytes: number;
  /** The derivative's pixel size, so a board can pick the smallest one that is
   *  still sharp at the size it renders (lib/media/album-photos.ts). */
  width: number;
  height: number;
};

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Draw a bitmap scaled to (w,h) and encode it to a WebP blob. */
async function encodeVariant(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, VARIANT_CONTENT_TYPE, VARIANT_QUALITY),
  );
  if (!blob) throw new Error("WebP encoding failed");
  return blob;
}

export async function uploadPhoto(input: {
  file: File;
  orgId: string;
  albumId: string;
  /** Sort position within the album — the caller spaces uploads out. */
  position: number;
  /** Called as the upload moves through its stages. */
  onProgress?: UploadProgress;
}): Promise<UploadResult> {
  const { file, orgId, albumId, position } = input;
  const progress: UploadProgress = input.onProgress ?? (() => {});

  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    const heic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
    return {
      ok: false,
      error: heic
        ? "iPhone HEIC photos aren't supported yet — export as JPEG first, or change the iPhone camera to “Most Compatible”."
        : `${file.name} isn't an image type we can read.`,
    };
  }

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const uploadedBy = userData.user?.id ?? null;

  // Dedup: if this exact file is already an asset in this org, just link it.
  progress("reading", 0.02);
  const original = await file.arrayBuffer();
  const checksum = await sha256Hex(original);
  const { data: existing } = await supabase
    .from("assets")
    .select("id")
    .eq("org_id", orgId)
    .eq("checksum_sha256", checksum)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    progress("saving", 0.95);
    const linked = await linkToAlbum(supabase, { orgId, albumId, assetId: existing.id, position });
    return linked ?? { ok: true, assetId: existing.id, deduped: true };
  }

  const assetId = crypto.randomUUID();
  let naturalWidth: number;
  let naturalHeight: number;
  let source: ImageBitmap;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
    naturalWidth = source.width;
    naturalHeight = source.height;
  } catch {
    return { ok: false, error: `${file.name} couldn't be read as an image.` };
  }

  const variants: Record<string, VariantEntry> = {};
  let canonical: VariantEntry | null = null;
  try {
    // Reading is the first ~10%, each size is an equal share of the next 80%
    // (half resizing, half uploading), and saving the row is the last 10%.
    const share = 0.8 / VARIANT_SPECS.length;
    for (const [i, spec] of VARIANT_SPECS.entries()) {
      const { width, height } = scaledSize(naturalWidth, naturalHeight, spec.maxEdge);
      progress("resizing", 0.1 + share * i);
      const blob = await encodeVariant(source, width, height);
      progress("uploading", 0.1 + share * (i + 0.5));
      const hash = (await sha256Hex(await blob.arrayBuffer())).slice(0, 16);
      const storagePath = `${orgId}/${assetId}/${spec.name}-${hash}.${VARIANT_EXTENSION}`;

      const { error } = await supabase.storage.from("assets").upload(storagePath, blob, {
        contentType: VARIANT_CONTENT_TYPE,
        upsert: false,
      });
      if (error) return { ok: false, error: `Upload failed for ${file.name}: ${error.message}` };

      const entry: VariantEntry = {
        storage_path: storagePath,
        content_hash: hash,
        extension: VARIANT_EXTENSION,
        content_type: VARIANT_CONTENT_TYPE,
        bytes: blob.size,
        width,
        height,
      };
      variants[spec.name] = entry;
      // The largest generated variant stands in as the row's canonical
      // storage_path/mime/size — the "original" the schema names, since v1 keeps
      // no separate original file.
      canonical = entry;
    }
  } finally {
    source.close();
  }

  if (!variants[BOARD_VARIANT] || !canonical) {
    return { ok: false, error: `Couldn't generate the board image for ${file.name}.` };
  }

  progress("saving", 0.92);
  const { error: insertError } = await supabase.from("assets").insert({
    id: assetId,
    org_id: orgId,
    kind: "image",
    storage_bucket: "assets",
    storage_path: canonical.storage_path,
    original_filename: file.name,
    mime_type: VARIANT_CONTENT_TYPE,
    byte_size: canonical.bytes,
    width: naturalWidth,
    height: naturalHeight,
    checksum_sha256: checksum,
    variants,
    status: "ready",
    exif_stripped: true,
    uploaded_by: uploadedBy,
    upload_source: "dashboard",
    moderation_status: "approved",
  });
  if (insertError) {
    // A concurrent upload of the same file won the checksum race — reuse it.
    const { data: raced } = await supabase
      .from("assets")
      .select("id")
      .eq("org_id", orgId)
      .eq("checksum_sha256", checksum)
      .is("deleted_at", null)
      .maybeSingle();
    if (raced) {
      const linked = await linkToAlbum(supabase, { orgId, albumId, assetId: raced.id, position });
      return linked ?? { ok: true, assetId: raced.id, deduped: true };
    }
    return { ok: false, error: `Couldn't save ${file.name}: ${insertError.message}` };
  }

  const linked = await linkToAlbum(supabase, { orgId, albumId, assetId, position });
  return linked ?? { ok: true, assetId, deduped: false };
}

/** Add an asset to an album. Returns an error result, or null on success — the
 *  album_items unique index makes a repeat link a no-op we treat as success. */
async function linkToAlbum(
  supabase: ReturnType<typeof createClient>,
  input: { orgId: string; albumId: string; assetId: string; position: number },
): Promise<UploadResult | null> {
  const { error } = await supabase.from("album_items").insert({
    org_id: input.orgId,
    album_id: input.albumId,
    asset_id: input.assetId,
    position: input.position,
  });
  // 23505 = unique violation: the asset is already in this album, which is fine.
  if (error && error.code !== "23505") {
    return { ok: false, error: `Couldn't add to the album: ${error.message}` };
  }
  return null;
}
