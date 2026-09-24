import type { BoardPhoto, BoardPhotoVariant } from "./album-photos";

/*
 * Which stored size of a photo a board shows — shared by the Collage and the
 * Gallery, so the two pick the same way and the display downloads exactly the
 * files they'll use.
 *
 * THE PLANNED SIZE is the smallest stored size at least as wide as the photo
 * renders on this screen (its cell, or its fitted box, times the pixel ratio),
 * or the largest when none is that big. That is what a widget asks the device
 * to download.
 *
 * THE SHOWN SIZE is the smallest size that is ON THE DEVICE and at least as
 * big as the planned one. Usually that's the planned one. Where a photo turns
 * up in two places — a bigger cell next cycle, or two widgets — whichever
 * bigger copy is already here serves the smaller place too, rather than a
 * second download. A page with no such copy for every photo isn't ready.
 *
 * Pure: no React, no DOM.
 */

/** A photo's stored sizes, smallest first. A photo from before sizes were
 *  listed has only its board size. */
export function photoVariants(photo: BoardPhoto): BoardPhotoVariant[] {
  if (photo.variants?.length) return photo.variants;
  return [
    { name: "display", src: photo.src, width: photo.width ?? 0, height: photo.height ?? 0, contentType: "", bytes: 0 },
  ];
}

/** The smallest stored size at least `neededWidth` wide, else the largest. */
export function pickVariant(variants: readonly BoardPhotoVariant[], neededWidth: number): BoardPhotoVariant {
  return variants.find((variant) => variant.width >= neededWidth) ?? variants[variants.length - 1];
}

/**
 * The size to show: the smallest one on the device that is at least as big as
 * the planned one. Null when none is — the page it's on waits. With no way to
 * ask (`isReady` null, the editor), the planned size.
 */
export function readyVariant(
  variants: readonly BoardPhotoVariant[],
  neededWidth: number,
  isReady: ((src: string) => boolean) | null,
): BoardPhotoVariant | null {
  const planned = pickVariant(variants, neededWidth);
  if (!isReady) return planned;
  for (const variant of variants) {
    if (variant.width >= planned.width && isReady(variant.src)) return variant;
  }
  return null;
}

/** How wide a photo draws, in px, filling a box with object-fit `fit`. */
export function fittedWidth(
  photo: { width: number | null; height: number | null },
  box: { width: number; height: number },
  fit: "contain" | "cover",
): number {
  if (!photo.width || !photo.height || box.width <= 0 || box.height <= 0) return box.width;
  const aspect = photo.width / photo.height;
  const heightBound = box.height * aspect;
  return fit === "cover" ? Math.max(box.width, heightBound) : Math.min(box.width, heightBound);
}
