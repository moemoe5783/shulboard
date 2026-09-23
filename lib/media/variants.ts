/*
 * The image derivatives the upload pipeline generates, and the shapes the rest
 * of the system already agreed on (lib/bundle/media.ts).
 *
 * v1 is BROWSER-SIDE and image-only: no HEIC conversion (an iPhone .heic upload
 * is refused up front, not silently mangled), no video. The gabbai's browser
 * resizes each photo to these sizes, re-encodes to WebP — which strips EXIF,
 * including GPS, as a side effect of re-encoding — and uploads the results. A
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

/** The image types the browser pipeline accepts. HEIC is deliberately absent —
 *  browsers can't decode it to a canvas, so it would fail silently; it's
 *  refused with a clear message instead (lib/media/upload.ts). */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

/** The scaled dimensions for a source of `width`×`height` capped to `maxEdge`,
 *  never enlarged. Pure, so the arithmetic is testable without a canvas. */
export function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
