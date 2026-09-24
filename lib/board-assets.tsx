"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EVERY_FILE_READY, type BoardFiles } from "./board-files";
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

// Which photo files are on hand, and the everything-ready default for anywhere
// without the display's runtime — lib/board-files.ts.
export { EVERY_FILE_READY, type BoardFiles } from "./board-files";

const BoardFilesContext = createContext<BoardFiles>(EVERY_FILE_READY);

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
      <BoardFilesContext.Provider value={files ?? EVERY_FILE_READY}>{children}</BoardFilesContext.Provider>
    </BoardAssetsContext.Provider>
  );
}

/** The files on hand. Without the display's runtime, EVERY_FILE_READY. */
export function useBoardFiles(): BoardFiles {
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
