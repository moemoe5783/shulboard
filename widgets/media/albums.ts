"use client";

import { useMemo } from "react";
import { useBoardAlbums } from "@/lib/board-assets";
import { useBoardLocation } from "@/lib/board-location";
import type { BoardPhoto } from "@/lib/media/album-photos";
import { albumSelectionKey, selectPhotos, type AlbumSelection } from "@/lib/media/selection";
import { todayIn } from "@/lib/media/visibility";
import { useSecond } from "@/lib/tick";

/*
 * The Gallery and Collage widgets' album selection (lib/media/selection.ts),
 * fed from the board's resolved albums and today's date in the shul's zone.
 * Not a widget: no manifest.ts here.
 */

export * from "@/lib/media/selection";

/** `selectPhotos` against the board's resolved albums and today's date in the
 *  shul's zone. Stable between renders on the same day, so a widget keyed on
 *  it doesn't re-run its layout every second. */
export function useSelectedPhotos(selection: AlbumSelection): BoardPhoto[] | undefined {
  const albums = useBoardAlbums();
  const location = useBoardLocation();
  const second = useSecond();
  const today = todayIn(location?.timeZone, second === null ? new Date() : new Date(second * 1000));
  const key = albumSelectionKey(selection);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for the selection's contents.
  return useMemo(() => selectPhotos(selection, albums, today), [key, albums, today]);
}
