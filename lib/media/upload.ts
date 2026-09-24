"use client";

import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_IMAGE_TYPES,
  BOARD_VARIANT,
  scaledSize,
  variantSpecsFor,
  FALLBACK_CONTENT_TYPE,
  FALLBACK_EXTENSION,
  MAX_STORED_BYTES,
  STORED_CONTENT_TYPES,
  VARIANT_CONTENT_TYPE,
  VARIANT_EXTENSION,
  VARIANT_QUALITY,
  isHeicFile,
} from "./variants";
import { decodeHeic } from "./heic";
import { removeStorageObjects } from "@/lib/storage/remove";

/*
 * The browser-side upload pipeline (v1, image-only, no HEIC).
 *
 * For each photo: decode it (auto-oriented from its EXIF), write the `assets`
 * row as 'pending', resize to each variant, re-encode to WebP (which drops
 * EXIF/GPS; JPEG where the browser can't make WebP), upload the derivatives to
 * the `assets` Storage bucket under <org>/<asset>/<variant>-<hash>.<ext>, then mark the row 'ready' and add the
 * `album_items` link — exactly the shape lib/bundle/media.ts and the /m proxy
 * already read. Any failure after the row exists removes the files already
 * uploaded and marks the row 'failed' with the reason.
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
export type UploadStage = "reading" | "converting" | "resizing" | "uploading" | "saving";
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

type Encoded = { blob: Blob; contentType: string; extension: string };

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, VARIANT_QUALITY));
}

/**
 * Draw a bitmap scaled to (w,h) and encode it — WebP, or JPEG where the
 * browser can't make WebP (lib/media/variants.ts, FALLBACK_CONTENT_TYPE).
 *
 * The type is read off the blob that comes back, never assumed from the one
 * asked for: a canvas without WebP support answers with a PNG and no error, and
 * the bucket refuses PNG (20260927090200_assets_bucket_limits.sql).
 */
async function encodeVariant(bitmap: ImageBitmap, width: number, height: number): Promise<Encoded> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const webp = await toBlob(canvas, VARIANT_CONTENT_TYPE);
  if (webp?.type === VARIANT_CONTENT_TYPE) {
    return { blob: webp, contentType: VARIANT_CONTENT_TYPE, extension: VARIANT_EXTENSION };
  }

  // JPEG has no transparency: a transparent pixel would come out black. Lay
  // the picture on white, which is what it looks like on a page.
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  const jpeg = await toBlob(canvas, FALLBACK_CONTENT_TYPE);
  if (jpeg?.type === FALLBACK_CONTENT_TYPE) {
    return { blob: jpeg, contentType: FALLBACK_CONTENT_TYPE, extension: FALLBACK_EXTENSION };
  }
  throw new Error("this browser can't encode WebP or JPEG");
}

export async function uploadPhoto(input: {
  file: File;
  orgId: string;
  albumId: string;
  /** Sort position within the album — the caller spaces uploads out. */
  position: number;
  /** Called as the upload moves through its stages. */
  onProgress?: UploadProgress;
  /** The Supabase client to write through. Defaults to the browser client;
   *  the upload lab (app/(dev)/upload-lab) passes a recording fake. */
  supabase?: ReturnType<typeof createClient>;
}): Promise<UploadResult> {
  const { file, orgId, albumId, position } = input;
  const progress: UploadProgress = input.onProgress ?? (() => {});

  const heic = isHeicFile(file);
  if (!heic && !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, error: `${file.name} isn't an image type we can read.` };
  }

  const supabase = input.supabase ?? createClient();
  const { data: userData } = await supabase.auth.getUser();
  const uploadedBy = userData.user?.id ?? null;

  // Dedup: if this exact file is already an asset in this org, just link it.
  progress("reading", 0.02);
  const original = await file.arrayBuffer();
  const checksum = await sha256Hex(original);
  const reused = await reuseExisting(supabase, { orgId, albumId, checksum, position });
  if (reused) return reused;

  const assetId = crypto.randomUUID();
  let naturalWidth: number;
  let naturalHeight: number;
  let source: ImageBitmap;
  try {
    if (heic) {
      // iPhone photos: decoded to pixels here (lib/media/heic.ts), then resized
      // and re-encoded to WebP below exactly like any other photo.
      progress("converting", 0.05);
      source = await decodeHeic(file);
    } else {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
    }
    naturalWidth = source.width;
    naturalHeight = source.height;
  } catch {
    return {
      ok: false,
      error: heic
        ? `${file.name} couldn't be converted from iPhone format. Try exporting it as JPEG.`
        : `${file.name} couldn't be read as an image.`,
    };
  }

  // THE ROW FIRST, as 'pending', before any file reaches Storage. Every file
  // uploaded below then belongs to a row, so a failure part-way — a dropped
  // connection, a closed tab — leaves a row the cleanup job can find and clear
  // (app/api/cron/clean-media), never files nothing points at. Nothing serves
  // a pending row: the bundle, the album preview and the /m proxy all read
  // 'ready' only.
  const folder = `${orgId}/${assetId}/`;
  const { error: pendingError } = await supabase.from("assets").insert({
    id: assetId,
    org_id: orgId,
    kind: "image",
    storage_bucket: "assets",
    storage_path: folder,
    original_filename: file.name,
    mime_type: VARIANT_CONTENT_TYPE,
    width: naturalWidth,
    height: naturalHeight,
    checksum_sha256: checksum,
    status: "pending",
    uploaded_by: uploadedBy,
    upload_source: "dashboard",
    moderation_status: "approved",
  });
  if (pendingError) {
    source.close();
    // 23505: another upload of the same file got its row in first.
    if (pendingError.code === "23505") {
      const raced = await reuseExisting(supabase, { orgId, albumId, checksum, position });
      if (raced) return raced;
    }
    return { ok: false, error: `Couldn't save ${file.name}: ${pendingError.message}` };
  }

  const uploaded: string[] = [];
  const fail = async (error: string): Promise<UploadResult> => {
    // Take back what went up, then say so on the row. If the removal itself
    // fails the row still names the folder, and the cleanup job finishes it.
    await removeStorageObjects(supabase, "assets", uploaded);
    await supabase
      .from("assets")
      .update({ status: "failed", processing_error: error })
      .eq("id", assetId)
      .eq("org_id", orgId);
    return { ok: false, error };
  };

  const variants: Record<string, VariantEntry> = {};
  let canonical: VariantEntry | null = null;
  try {
    // Reading is the first ~10%, each size is an equal share of the next 80%
    // (half resizing, half uploading), and saving the row is the last 10%.
    const specs = variantSpecsFor(naturalWidth, naturalHeight);
    const share = 0.8 / specs.length;
    for (const [i, spec] of specs.entries()) {
      const { width, height } = scaledSize(naturalWidth, naturalHeight, spec.maxEdge);
      progress("resizing", 0.1 + share * i);
      const { blob, contentType, extension } = await encodeVariant(source, width, height);
      // Storage refuses anything else (the bucket's own limits); saying why
      // here beats its bare 4xx.
      if (!STORED_CONTENT_TYPES.includes(blob.type) || blob.type !== contentType) {
        return await fail(`${file.name} came out as ${blob.type || "an unknown type"}, which can't be stored.`);
      }
      if (blob.size > MAX_STORED_BYTES) {
        return await fail(`${file.name} is too large to store at ${spec.name} size.`);
      }
      progress("uploading", 0.1 + share * (i + 0.5));
      const hash = (await sha256Hex(await blob.arrayBuffer())).slice(0, 16);
      const storagePath = `${folder}${spec.name}-${hash}.${extension}`;

      const { error } = await supabase.storage.from("assets").upload(storagePath, blob, {
        contentType,
        upsert: false,
      });
      if (error) return await fail(`Upload failed for ${file.name}: ${error.message}`);
      uploaded.push(storagePath);

      const entry: VariantEntry = {
        storage_path: storagePath,
        content_hash: hash,
        extension,
        content_type: contentType,
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
  } catch (error) {
    return await fail(`Couldn't resize ${file.name}: ${error instanceof Error ? error.message : "unknown error"}`);
  } finally {
    source.close();
  }

  if (!variants[BOARD_VARIANT] || !canonical) {
    return await fail(`Couldn't generate the board image for ${file.name}.`);
  }

  progress("saving", 0.92);
  const { error: readyError } = await supabase
    .from("assets")
    .update({
      storage_path: canonical.storage_path,
      mime_type: canonical.content_type,
      byte_size: canonical.bytes,
      variants,
      status: "ready",
      exif_stripped: true,
    })
    .eq("id", assetId)
    .eq("org_id", orgId);
  if (readyError) return await fail(`Couldn't save ${file.name}: ${readyError.message}`);

  const linked = await linkToAlbum(supabase, { orgId, albumId, assetId, position });
  // A photo in no album has nowhere in Media to be seen or removed, so a
  // failed link undoes the whole upload rather than leaving it stranded.
  if (linked) return await fail(linked.ok ? `Couldn't add ${file.name} to the album.` : linked.error);
  return { ok: true, assetId, deduped: false };
}

/** How long a 'pending' row is trusted to be an upload still in progress. A
 *  tab closed mid-upload leaves one behind; past this, it's abandoned. */
const PENDING_ABANDONED_MS = 10 * 60 * 1000;

/**
 * If this file is already a live asset in the org, link it to the album and
 * return the result; null means "go ahead and upload it".
 *
 * A 'pending' row is another upload of the same file. Recent: it's still
 * going, and a second copy would only race it. Old: its tab is gone — mark it
 * failed (which frees the checksum, see the dedup index) and upload afresh;
 * the cleanup job removes whatever files it left.
 */
async function reuseExisting(
  supabase: ReturnType<typeof createClient>,
  input: { orgId: string; albumId: string; checksum: string; position: number },
): Promise<UploadResult | null> {
  const { data: existing } = await supabase
    .from("assets")
    .select("id, status, created_at")
    .eq("org_id", input.orgId)
    .eq("checksum_sha256", input.checksum)
    .is("deleted_at", null)
    .neq("status", "failed")
    .maybeSingle();
  if (!existing) return null;

  if (existing.status === "ready") {
    const linked = await linkToAlbum(supabase, { ...input, assetId: existing.id });
    return linked ?? { ok: true, assetId: existing.id, deduped: true };
  }

  if (Date.now() - Date.parse(existing.created_at) < PENDING_ABANDONED_MS) {
    return { ok: false, error: "This photo is still uploading. Try again in a minute." };
  }
  await supabase
    .from("assets")
    .update({ status: "failed", processing_error: "Upload abandoned before it finished." })
    .eq("id", existing.id)
    .eq("org_id", input.orgId)
    .eq("status", "pending");
  return null;
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
