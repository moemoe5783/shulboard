"use client";

/*
 * iPhone HEIC/HEIF photos, decoded in the browser so the rest of the upload
 * pipeline (resize, re-encode to WebP, strip EXIF) treats them like any JPEG.
 *
 * NATIVE FIRST. Safari 17+ decodes HEIC itself, so createImageBitmap is tried
 * before anything is downloaded. Everywhere else the decoder is libheif,
 * compiled to WebAssembly (the `heic-to` package, LGPL-3.0), and it is loaded
 * ONLY here, by dynamic import, when a HEIC file actually arrives — a gabbai
 * uploading JPEGs never downloads it, and it stays its own unmodified module.
 * The `csp` build is used because it needs no `eval`.
 *
 * ORIENTATION: libheif applies the file's own rotation and mirroring (HEIC
 * stores them as `irot`/`imir` boxes, not EXIF), so a portrait comes out
 * portrait; the pipeline then records the size after that, which is what the
 * collage lays out by.
 */

export async function decodeHeic(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Not natively supported here — fall through to libheif.
  }
  const { heicTo } = await import("heic-to/csp");
  return heicTo({ blob: file, type: "bitmap" });
}
