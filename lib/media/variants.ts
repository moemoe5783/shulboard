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
 * wall. Ordered small-to-large; the pipeline skips any whose maxEdge is past the
 * original's longest edge except that `display` is always written (the board
 * needs it) at whatever size the original allows.
 */
export const VARIANT_SPECS: VariantSpec[] = [
  { name: "thumb", maxEdge: 400 },
  { name: BOARD_VARIANT, maxEdge: 1080 },
  { name: "large", maxEdge: 2160 },
];

/** WebP everywhere — one servable type, good compression, universal on the
 *  browsers a dashboard runs in and the TV browsers the display runs on. */
export const VARIANT_CONTENT_TYPE = "image/webp";
export const VARIANT_EXTENSION = "webp";
export const VARIANT_QUALITY = 0.85;

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
