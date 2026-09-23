"use client";

import { useEffect, useState } from "react";
import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import { createClient } from "@/lib/supabase/client";
import { chosenAlbumIds, type AlbumSelection } from "./albums";

/*
 * The album chooser shared by the Gallery and Collage settings panels, and the
 * org's album list the Image widget's photo picker browses. Albums load live
 * through the browser client (RLS scopes them to the member's org). A widget
 * stores only album ids; the photos are resolved at render time
 * (lib/media/album-photos.ts), so a board updates when an album does without
 * being re-edited.
 */

export type OrgAlbum = { id: string; name: string; org_id: string };

/** The org's albums, newest first. `null` while loading. */
export function useOrgAlbums(): OrgAlbum[] | null {
  const [albums, setAlbums] = useState<OrgAlbum[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("albums")
      .select("id, name, org_id")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setAlbums(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return albums;
}

/**
 * Pick several albums, or every album except some. "Every album" includes ones
 * made later, which is the point of offering it: a shul that adds an album per
 * simcha doesn't have to come back and tick each one.
 */
export function AlbumsField({
  value,
  onChange,
}: {
  value: AlbumSelection;
  onChange: (patch: Partial<AlbumSelection>) => void;
}) {
  const albums = useOrgAlbums();
  const all = value.albumMode === "all";
  const ticked = new Set(all ? value.excludedAlbumIds : chosenAlbumIds(value));

  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Writing albumIds also retires the legacy single albumId.
    onChange(all ? { excludedAlbumIds: [...next] } : { albumIds: [...next], albumId: "" });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Albums</span>
        <select
          value={value.albumMode}
          onChange={(event) => {
            const mode = event.target.value as AlbumSelection["albumMode"];
            onChange(
              mode === "selected"
                ? { albumMode: mode, albumIds: chosenAlbumIds(value), albumId: "" }
                : { albumMode: mode },
            );
          }}
          className={PANEL_CONTROL}
        >
          <option value="selected">These albums</option>
          <option value="all">All albums, except…</option>
        </select>
      </label>

      {albums === null ? (
        <span className={PANEL_LABEL}>Loading albums…</span>
      ) : albums.length === 0 ? (
        <span className={PANEL_LABEL}>No albums yet — add one in Media, then pick it here.</span>
      ) : (
        <>
          <span className={PANEL_LABEL}>{all ? "Tick any to leave out" : "Tick the albums to show"}</span>
          <ul className="border-paper/15 flex max-h-48 flex-col gap-1 overflow-auto rounded-[5px] border p-2" data-albums-field>
            {albums.map((album) => (
              <li key={album.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ticked.has(album.id)}
                    onChange={() => toggle(album.id)}
                    className={PANEL_CHECKBOX}
                  />
                  <span className="text-cell text-paper truncate">{album.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
