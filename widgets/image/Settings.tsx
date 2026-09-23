"use client";

import { useEffect, useRef, useState } from "react";
import { CHROME_BUTTON } from "@/app/(dev)/editor-lab/chrome";
import { NumberField } from "@/components/editor/NumberField";
import { PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import { fetchAlbumPhotos, type BoardPhoto } from "@/lib/media/album-photos";
import { uploadPhoto } from "@/lib/media/upload";
import { createClient } from "@/lib/supabase/client";
import type { WidgetSettingsProps } from "@/widgets/types";
import { useOrgAlbums } from "../media/AlbumField";
import type { ImageConfig } from "./manifest";

/*
 * The Image widget's panel. The picture comes from the shul's own Media — an
 * album photo, or one uploaded right here into an album — never a pasted web
 * link: the document stores the asset id, the bundle turns it into a cached
 * media-proxy path (lib/bundle/assemble.ts), and so the picture keeps showing
 * offline and survives the file being re-processed. `src` is also set here so
 * the editor preview shows the choice immediately; the bundle overwrites it
 * from the asset id when the board is published.
 */

export function Settings({ config, onChange }: WidgetSettingsProps<ImageConfig>) {
  const [browsing, setBrowsing] = useState(!config.src);
  const legacyLink = config.src !== "" && config.assetId === "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className={PANEL_LABEL}>Picture</span>
        {config.src ? (
          <div className="border-paper/15 flex items-center gap-3 rounded-[5px] border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a media-proxy path. */}
            <img src={config.src} alt="" className="size-14 rounded-[5px] object-cover" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-cell text-paper truncate">{config.alt || "Chosen picture"}</span>
              <button
                type="button"
                className="text-meta text-paper/70 hover:text-paper self-start underline"
                onClick={() => setBrowsing(!browsing)}
              >
                {browsing ? "Close Media" : "Change picture"}
              </button>
            </div>
          </div>
        ) : (
          <span className={PANEL_LABEL}>Choose a photo from Media, or upload one.</span>
        )}
        {legacyLink && (
          <span className="text-meta text-stale">
            This picture is a web link, so it won&rsquo;t show when a screen is offline. Choose it from Media instead.
          </span>
        )}
      </div>

      {browsing && (
        <MediaPicker
          selectedAssetId={config.assetId}
          onPick={(photo) => {
            onChange({ assetId: photo.assetId, src: photo.src, alt: config.alt || photo.caption || "" });
            setBrowsing(false);
          }}
        />
      )}

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Description (read aloud by screen readers)</span>
        <input
          type="text"
          value={config.alt}
          maxLength={300}
          onChange={(event) => onChange({ alt: event.target.value })}
          className={PANEL_CONTROL}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Fit</span>
        <select
          value={config.fit}
          onChange={(event) => onChange({ fit: event.target.value as ImageConfig["fit"] })}
          className={PANEL_CONTROL}
        >
          <option value="cover">Fill the box (crops the edges)</option>
          <option value="contain">Show the whole picture</option>
        </select>
      </label>

      <NumberField label="Corner radius" value={config.radius} onChange={(radius) => onChange({ radius })} min={0} max={200} />
    </div>
  );
}

/** Browse an album's photos and pick one, or upload a new one into it. */
function MediaPicker({ selectedAssetId, onPick }: { selectedAssetId: string; onPick: (photo: BoardPhoto) => void }) {
  const albums = useOrgAlbums();
  const [albumId, setAlbumId] = useState("");
  const [photos, setPhotos] = useState<{ albumId: string; list: BoardPhoto[] } | null>(null);
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeAlbum = albumId || albums?.[0]?.id || "";
  const album = albums?.find((a) => a.id === activeAlbum) ?? null;

  useEffect(() => {
    if (!activeAlbum) return;
    let cancelled = false;
    fetchAlbumPhotos(createClient(), [activeAlbum]).then((resolved) => {
      if (!cancelled) setPhotos({ albumId: activeAlbum, list: resolved[activeAlbum] ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, [activeAlbum, reload]);

  const list = photos && photos.albumId === activeAlbum ? photos.list : null;

  const uploadOne = async (file: File) => {
    if (!album) return;
    setError(null);
    setUpload({ name: file.name, progress: 0 });
    const result = await uploadPhoto({
      file,
      orgId: album.org_id,
      albumId: album.id,
      position: Date.now(),
      onProgress: (_stage, progress) => setUpload({ name: file.name, progress }),
    });
    setUpload(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const resolved = await fetchAlbumPhotos(createClient(), [album.id]);
    const uploaded = (resolved[album.id] ?? []).find((p) => p.assetId === result.assetId);
    setPhotos({ albumId: album.id, list: resolved[album.id] ?? [] });
    if (uploaded) onPick(uploaded);
    else setReload((n) => n + 1);
  };

  if (albums === null) return <span className={PANEL_LABEL}>Loading Media…</span>;
  if (albums.length === 0) {
    return <span className={PANEL_LABEL}>No albums yet — make one in Media and add photos, then pick one here.</span>;
  }

  return (
    <div className="border-paper/15 flex flex-col gap-2 rounded-[6px] border p-2" data-media-picker>
      <select value={activeAlbum} onChange={(event) => setAlbumId(event.target.value)} className={PANEL_CONTROL} aria-label="Album">
        {albums.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      {list === null ? (
        <span className={PANEL_LABEL}>Loading photos…</span>
      ) : list.length === 0 ? (
        <span className={PANEL_LABEL}>This album has no photos yet.</span>
      ) : (
        <ul className="grid max-h-64 grid-cols-3 gap-1.5 overflow-auto">
          {list.map((photo) => {
            const thumb = photo.variants[0]?.src ?? photo.src;
            const chosen = photo.assetId === selectedAssetId;
            return (
              <li key={photo.assetId}>
                <button
                  type="button"
                  onClick={() => onPick(photo)}
                  aria-pressed={chosen}
                  aria-label={photo.caption || "Photo"}
                  className={`block aspect-square w-full overflow-hidden rounded-[5px] border-2 ${
                    chosen ? "border-verdigris" : "hover:border-paper/40 border-transparent"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a media-proxy path. */}
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {upload ? (
        <div className="flex flex-col gap-1" role="status">
          <span className="text-meta text-paper/70 truncate">Uploading {upload.name}…</span>
          <div className="bg-paper/15 h-1.5 w-full overflow-hidden rounded-[5px]">
            <div className="bg-verdigris h-full transition-[width] duration-300" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <button type="button" className={`${CHROME_BUTTON} border-paper/20 border`} onClick={() => inputRef.current?.click()}>
          Upload a photo to {album?.name ?? "this album"}
        </button>
      )}
      {error && <span className="text-meta text-offline">{error}</span>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadOne(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
