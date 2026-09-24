"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { BoardAlbums, BoardPhoto } from "@/lib/media/album-photos";

/*
 * Resolved album photos, handed to the widgets that show them (Gallery,
 * Collage) — the same shape whether it came from the bundle on a display or a
 * live query in the editor, so the Renderer never learns which (plan.md §2's
 * no-fork rule, the same contract BoardZmanim and BoardLocation follow).
 *
 * A map value of `undefined` means "not resolved" (no provider, or still
 * loading); an empty array means "resolved, but the album has no photos". The
 * widget tells those apart in its own empty states.
 */

const BoardAssetsContext = createContext<BoardAlbums | null>(null);

/**
 * Which photo files are on hand — the other half of what a Gallery or Collage
 * needs to know, and the same no-fork contract as the albums above.
 *
 * A board on a wall only shows a page once every file on it is on the device
 * (the atomic swap's promise, lib/display/assets.ts). The widget doesn't learn
 * how or where files are kept; it hears two things:
 *
 *  - `isReady(src)`: this file can be shown now. `version` bumps as more
 *    arrive, so a widget waiting on a page knows to look again.
 *  - `want(owner, srcs)`: the files its pages use, in the order it will show
 *    them. That's what gets downloaded, first things first — the widget is the
 *    only thing that knows its real size on this screen, which decides the
 *    layout and so the files. `complete` says the list covers every page.
 *
 * No provider — the editor, a lab page — means everything is ready and
 * nothing is wanted: files load as they're shown, as on any web page.
 */
export type BoardFiles = {
  isReady: (src: string) => boolean;
  version: number;
  want: (owner: string, srcs: readonly string[], complete: boolean) => void;
};

const BoardFilesContext = createContext<BoardFiles | null>(null);

export function BoardAssetsProvider({
  albums,
  files = null,
  children,
}: {
  albums: BoardAlbums | null;
  files?: BoardFiles | null;
  children: ReactNode;
}) {
  return (
    <BoardAssetsContext.Provider value={albums}>
      <BoardFilesContext.Provider value={files}>{children}</BoardFilesContext.Provider>
    </BoardAssetsContext.Provider>
  );
}

/** The files on hand, or null where every file counts as ready (the editor). */
export function useBoardFiles(): BoardFiles | null {
  return useContext(BoardFilesContext);
}

/** Every resolved album, or null when none are resolved yet. */
export function useBoardAlbums(): BoardAlbums | null {
  return useContext(BoardAssetsContext);
}

/** The resolved photos for one album, `undefined` when not resolved. */
export function useBoardAlbum(albumId: string | null | undefined): BoardPhoto[] | undefined {
  const albums = useContext(BoardAssetsContext);
  if (!albumId || !albums) return undefined;
  return albums[albumId];
}

export type { BoardPhoto, BoardAlbums };
