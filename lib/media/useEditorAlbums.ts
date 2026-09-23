"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardWidget } from "@/lib/board-doc";
import type { BoardAlbums } from "@/lib/media/album-photos";
import { fetchAlbumPhotos } from "@/lib/media/album-photos";
import { createClient } from "@/lib/supabase/client";
import { albumIdsFor } from "@/lib/bundle/assemble";

/*
 * The editor's live equivalent of the bundle's album resolution — it fetches
 * the photos for every album a Gallery/Collage widget on the board binds to, so
 * the editor preview shows the same thing the display will (plan.md §2's no-fork
 * rule: the Renderer reads photos from context either way, never knowing which
 * side resolved them).
 *
 * Refetches only when the SET of referenced albums changes, not on every edit —
 * the album ids are keyed to a string, so dragging a widget doesn't re-query.
 */
export function useEditorAlbums(widgets: BoardWidget[]): BoardAlbums | null {
  const key = useMemo(() => [...new Set(albumIdsFor(widgets))].sort().join(","), [widgets]);
  // Stored WITH the key it was fetched for, so a stale result for a previous set
  // of albums is treated as "not resolved yet" rather than shown. setState is
  // only ever called from the async callback below, never synchronously in the
  // effect body (react-hooks/set-state-in-effect).
  const [resolved, setResolved] = useState<{ key: string; albums: BoardAlbums } | null>(null);

  useEffect(() => {
    if (key === "") return;
    let cancelled = false;
    fetchAlbumPhotos(createClient(), key.split(",")).then((albums) => {
      if (!cancelled) setResolved({ key, albums });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // No albums referenced: resolved-and-empty. Otherwise the fetched map once it
  // matches the current key, or null while it's still loading.
  if (key === "") return {};
  return resolved && resolved.key === key ? resolved.albums : null;
}
