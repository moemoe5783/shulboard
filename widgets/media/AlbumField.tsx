"use client";

import { useEffect, useState } from "react";
import { PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import { createClient } from "@/lib/supabase/client";

/*
 * The album chooser shared by the Gallery and Collage settings panels — a
 * <select> of the org's albums, loaded live through the browser client (RLS
 * scopes it to the member's org). The widget stores only the album id; the
 * photos are resolved at render time (lib/media/album-photos.ts), so a board
 * updates when the album does without being re-edited.
 */
export function AlbumField({ value, onChange }: { value: string; onChange: (albumId: string) => void }) {
  const [albums, setAlbums] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("albums")
      .select("id, name")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setAlbums(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <label className="flex flex-col gap-1">
      <span className={PANEL_LABEL}>Album</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={PANEL_CONTROL}>
        <option value="">Choose an album…</option>
        {albums?.map((album) => (
          <option key={album.id} value={album.id}>
            {album.name}
          </option>
        ))}
      </select>
      {albums && albums.length === 0 && (
        <span className={PANEL_LABEL}>No albums yet — add one in Media, then pick it here.</span>
      )}
    </label>
  );
}
