/*
 * The image derivatives the upload pipeline generates, and the shapes the rest
 * of the system already agreed on (lib/bundle/media.ts).
 *
 * v1 is BROWSER-SIDE and image-only (no video). iPhone HEIC photos are decoded
 * first (lib/media/heic.ts). The gabbai's browser then resizes each photo to
 * these sizes — scaled down to fit, never cropped and never enlarged — re-encodes
 * to WebP, which strips EXIF, including GPS, as a side effect, and uploads the
 * results. No separate original is kept. A
 * server pipeline (sharp/libheif) can replace this later without changing the
 * stored shape, which is the whole reason that shape lives in one place.
 */

/** The board embeds this one (lib/bundle/build.ts's BOARD_ASSET_VARIANT), so it
 *  must always be generated. */
export const BOARD_VARIANT = "display";

export type VariantSpec = {
  /** The name stored as the key in `assets.variants` and put in the proxy path. */
  name: string;
  /** The longest edge, in pixels, the derivative is scaled down to. Never up:
   *  a photo smaller than this is kept at its own size. */
  maxEdge: number;
};

/**
 * thumb for the album grid and pickers, display for the board, large for a 4K
 * wall. Ordered small-to-large. See `variantSpecsFor` for which a given photo
 * gets.
 */
export const VARIANT_SPECS: VariantSpec[] = [
  { name: "thumb", maxEdge: 400 },
  { name: BOARD_VARIANT, maxEdge: 1080 },
  { name: "large", maxEdge: 2160 },
];

/** thumb and display are written for every photo — the album grid and the
 *  board read them by name. */
const ALWAYS = new Set(["thumb", BOARD_VARIANT]);

/**
 * The sizes one photo gets. A size is skipped when the photo's long edge is no
 * bigger than the next-smaller size's: it would come out pixel-for-pixel the
 * same as that one (sizes are never enlarged), so it's the same picture stored
 * twice. A 1000px photo gets thumb and display; a 3000px one gets all three.
 * thumb and display are always written, however small the photo.
 *
 * Every reader falls back to the largest size on file when the one it asks for
 * isn't there (lib/bundle/media.ts, `readBestVariant`).
 */
export function variantSpecsFor(width: number, height: number): VariantSpec[] {
  const longest = Math.max(width, height);
  return VARIANT_SPECS.filter((spec, i) => ALWAYS.has(spec.name) || longest > VARIANT_SPECS[i - 1].maxEdge);
}

/** WebP everywhere — one servable type, good compression, universal on the
 *  browsers a dashboard runs in and the TV browsers the display runs on. */
export const VARIANT_CONTENT_TYPE = "image/webp";
export const VARIANT_EXTENSION = "webp";
export const VARIANT_QUALITY = 0.85;

/**
 * JPEG, for the browser that can't make WebP. Asked for WebP, a canvas that
 * doesn't support it hands back a PNG without a word (older Safari), and a
 * 2160px PNG photo can be tens of megabytes — so the upload re-encodes to
 * JPEG instead. JPEG has no transparency, so a transparent picture is laid on
 * white first; WebP keeps it.
 */
export const FALLBACK_CONTENT_TYPE = "image/jpeg";
export const FALLBACK_EXTENSION = "jpg";

/** The only types the `assets` bucket accepts, and the largest file —
 *  enforced by Storage itself (20260927090200_assets_bucket_limits.sql) and
 *  checked here first, so a gabbai gets a reason rather than a refusal. Keep
 *  the two in step. */
export const STORED_CONTENT_TYPES = [VARIANT_CONTENT_TYPE, FALLBACK_CONTENT_TYPE];
export const MAX_STORED_BYTES = 8 * 1024 * 1024;

/** The image types a browser decodes itself. HEIC/HEIF (iPhone photos) is
 *  accepted too, but converted first — see `isHeicFile` and lib/media/heic.ts. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

/** Whether a file is an iPhone HEIC/HEIF photo. By type when the browser
 *  reports one; by name otherwise, since many browsers report HEIC as "". */
export function isHeicFile(file: { type: string; name: string }): boolean {
  return /image\/hei[cf](-sequence)?/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** What a file input should offer: every image, plus HEIC by extension for the
 *  desktop browsers that don't count it as an image type. */
export const IMAGE_INPUT_ACCEPT = "image/*,.heic,.heif";

/** The scaled dimensions for a source of `width`×`height` capped to `maxEdge`,
 *  never enlarged. Pure, so the arithmetic is testable without a canvas. */
export function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
