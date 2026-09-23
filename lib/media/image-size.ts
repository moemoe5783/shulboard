/*
 * An image's pixel size, read from its header — no decoder, no canvas.
 *
 * Used by the photo-size backfill (app/(app)/media/actions.ts): a photo stored
 * before its width and height were recorded gets them from its own derivative,
 * which the collage engine needs because it lays photos out by aspect ratio.
 * The derivatives are the ones the upload pipeline writes — WebP, already
 * EXIF-rotated — but PNG and JPEG are read too so an older or hand-loaded file
 * doesn't need a separate path.
 *
 * Pure, so scripts/test-media.ts can drive it with hand-built headers.
 */

export type ImageSize = { width: number; height: number };

const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const ascii = (b: Uint8Array, at: number, length: number) => String.fromCharCode(...b.subarray(at, at + length));

function webp(b: Uint8Array): ImageSize | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    // Frame tag (3 bytes) then the start code 9d 01 2a, then 14-bit sizes.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return null;
}

function png(b: Uint8Array): ImageSize | null {
  if (b.length < 24 || b[0] !== 0x89 || ascii(b, 1, 3) !== "PNG" || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    // SOF0–SOF15, minus DHT (C4), JPG (C8) and DAC (CC), carry the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16be(b, at + 7), height: u16be(b, at + 5) };
    }
    at += 2 + u16be(b, at + 2);
  }
  return null;
}

/** The size in the header, or null for a format this doesn't read or a
 *  truncated file. A zero dimension is treated as unreadable. */
export function readImageSize(bytes: Uint8Array): ImageSize | null {
  const size = webp(bytes) ?? png(bytes) ?? jpeg(bytes);
  return size && size.width > 0 && size.height > 0 ? size : null;
}
