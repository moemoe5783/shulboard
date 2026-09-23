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
 * Refetches when the SET of referenced albums changes (not on every edit — the
 * ids are keyed to a string, so dragging a widget doesn't re-query), and to pick
 * up album changes made elsewhere — photos added in another tab — when the
 * window regains focus and every REFRESH_MS while it's visible. A collage takes
 * the new photos at its next page boundary (widgets/collage/player.ts).
 *
 * NOT a Realtime subscription, deliberately: `postgres_changes` on album_items
 * would put the table in the Realtime publication, and DELETE events there are
 * delivered without RLS filtering — every org's editor would hear about every
 * other org's removals. Screens get album changes over their own authorized
 * channel already (the rebuild triggers → `bundle_changed`, plan.md §3d).
 */

const REFRESH_MS = 20_000;

export function useEditorAlbums(widgets: BoardWidget[]): BoardAlbums | null {
  const key = useMemo(() => [...new Set(albumIdsFor(widgets))].sort().join(","), [widgets]);
  // Stored WITH the key it was fetched for, so a stale result for a previous set
  // of albums is treated as "not resolved yet" rather than shown. setState is
  // only ever called from async callbacks, never synchronously in an effect body
  // (react-hooks/set-state-in-effect).
  const [resolved, setResolved] = useState<{ key: string; albums: BoardAlbums } | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (key === "") return;
    const bump = () => {
      if (document.visibilityState === "visible") setRefresh((n) => n + 1);
    };
    const timer = setInterval(bump, REFRESH_MS);
    window.addEventListener("focus", bump);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", bump);
    };
  }, [key]);

  useEffect(() => {
    if (key === "") return;
    let cancelled = false;
    fetchAlbumPhotos(createClient(), key.split(",")).then((albums) => {
      if (cancelled) return;
      // Keep the same object when nothing changed, so a refresh that finds the
      // album as it was doesn't ripple a new value through every widget.
      setResolved((previous) =>
        previous && previous.key === key && JSON.stringify(previous.albums) === JSON.stringify(albums)
          ? previous
          : { key, albums },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [key, refresh]);

  // No albums referenced: resolved-and-empty. Otherwise the fetched map once it
  // matches the current key, or null while it's still loading.
  if (key === "") return {};
  return resolved && resolved.key === key ? resolved.albums : null;
}
