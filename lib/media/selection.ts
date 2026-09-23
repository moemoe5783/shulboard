import { z } from "zod";
import type { BoardAlbums, BoardPhoto } from "./album-photos";
import type { DataNeed } from "../../widgets/types.ts";
import { isShowing } from "./visibility.ts";

/*
 * Which albums a Gallery or Collage shows — several chosen albums, or every
 * album the shul has except the ones it rules out — and the merged, visible
 * photo list that comes out of that. Pure (no React, no DOM, extensioned
 * relative imports), so scripts/test-album-selection.ts drives it directly;
 * widgets/media/albums.ts adds the hook that feeds it the board's albums.
 *
 * "EVERY ALBUM" IS A NEED, NOT A LIST. The widget can't know the shul's albums
 * when it's configured — one made next week has to show up too — so it
 * declares `{ kind: "album", albumId: "*" }` and the two places that resolve
 * albums (lib/bundle/build.ts on the server, lib/media/useEditorAlbums.ts in
 * the editor) expand it to every album on file. The resolved map then holds
 * every album, and "all except" is that map's keys minus the excluded ones.
 *
 * PHOTOS WITH AN END DATE that has passed in the shul's own zone are dropped
 * here, on the device, against its own clock — so a screen that has been
 * offline since before the date still stops showing them at the right
 * midnight (album_items.display_until, ./visibility.ts).
 */

export const ALL_ALBUMS = "*";

export const albumSelectionFields = {
  /** The single album of a collage or gallery saved before several could be
   *  chosen. Read as `albumIds: [albumId]` when `albumIds` is empty. */
  albumId: z.string().max(64).default("").catch(""),
  /** `selected`: the albums in `albumIds`. `all`: every album except those in
   *  `excludedAlbumIds`, including albums added later. */
  albumMode: z.enum(["selected", "all"]).default("selected").catch("selected"),
  albumIds: z.array(z.string().max(64)).max(100).default([]).catch([]),
  excludedAlbumIds: z.array(z.string().max(64)).max(500).default([]).catch([]),
} as const;

export type AlbumSelection = {
  albumId: string;
  albumMode: "selected" | "all";
  albumIds: string[];
  excludedAlbumIds: string[];
};

/** The chosen album ids, folding in the legacy single `albumId`. Tolerates a
 *  config with the fields missing, since stored config isn't re-validated. */
export function chosenAlbumIds(selection: AlbumSelection): string[] {
  const listed = Array.isArray(selection.albumIds) ? selection.albumIds.filter((id) => typeof id === "string" && id) : [];
  const legacy = typeof selection.albumId === "string" && selection.albumId ? [selection.albumId] : [];
  return [...new Set(listed.length > 0 ? listed : legacy)];
}

function excludedIds(selection: AlbumSelection): string[] {
  return Array.isArray(selection.excludedAlbumIds) ? selection.excludedAlbumIds.filter((id) => typeof id === "string") : [];
}

/** Whether anything has been chosen at all — an unconfigured widget shows its
 *  "pick an album" hint rather than an empty board. */
export function hasAlbumSelection(selection: AlbumSelection): boolean {
  return selection.albumMode === "all" || chosenAlbumIds(selection).length > 0;
}

/** The data needs a selection declares (widgets' `dataNeeds`). */
export function albumSelectionNeeds(selection: AlbumSelection): readonly DataNeed[] {
  if (selection.albumMode === "all") return [{ kind: "album", albumId: ALL_ALBUMS }];
  return chosenAlbumIds(selection).map((albumId) => ({ kind: "album", albumId }));
}

/** A stable string for "which albums", for keys and shuffle seeds. */
export function albumSelectionKey(selection: AlbumSelection): string {
  return selection.albumMode === "all"
    ? `all-except:${[...new Set(excludedIds(selection))].sort().join(",")}`
    : `albums:${chosenAlbumIds(selection).join(",")}`;
}

/**
 * The photos a selection shows, from a resolved album map: albums in order
 * (the chosen order, or the map's own for "all"), each album's photos in album
 * order, a photo in two chosen albums shown once, and photos past their end
 * date left out. `undefined` while any needed album is still unresolved.
 */
export function selectPhotos(
  selection: AlbumSelection,
  albums: BoardAlbums | null,
  today: string,
): BoardPhoto[] | undefined {
  if (!albums) return undefined;
  let ids: string[];
  if (selection.albumMode === "all") {
    const excluded = new Set(excludedIds(selection));
    // Sorted, because the editor and the bundle build their maps in different
    // insertion orders, and the order feeds the layout seed — both sides have
    // to walk the albums identically for a screen to match the preview.
    ids = Object.keys(albums)
      .filter((id) => id !== ALL_ALBUMS && !excluded.has(id))
      .sort();
  } else {
    ids = chosenAlbumIds(selection);
    if (ids.some((id) => albums[id] === undefined)) return undefined;
  }

  const seen = new Set<string>();
  const out: BoardPhoto[] = [];
  for (const id of ids) {
    for (const photo of albums[id] ?? []) {
      if (seen.has(photo.assetId) || !isShowing(photo.displayUntil, today)) continue;
      seen.add(photo.assetId);
      out.push(photo);
    }
  }
  return out;
}
