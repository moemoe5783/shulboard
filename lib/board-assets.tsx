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

export function BoardAssetsProvider({ albums, children }: { albums: BoardAlbums | null; children: ReactNode }) {
  return <BoardAssetsContext.Provider value={albums}>{children}</BoardAssetsContext.Provider>;
}

/** The resolved photos for one album, `undefined` when not resolved. */
export function useBoardAlbum(albumId: string | null | undefined): BoardPhoto[] | undefined {
  const albums = useContext(BoardAssetsContext);
  if (!albumId || !albums) return undefined;
  return albums[albumId];
}

export type { BoardPhoto, BoardAlbums };
