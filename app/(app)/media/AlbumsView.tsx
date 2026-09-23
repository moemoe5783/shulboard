"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClassName } from "@/components/Button";
import { createAlbum, deleteAlbum } from "./actions";

/*
 * The album list — a table of records, per design.md §5 ("Tables for lists").
 * Photos themselves are a grid (they're images, not records) on the album
 * detail page; the list of albums is a table like every other list.
 */

type Album = { id: string; name: string; count: number };

export function AlbumsView({ albums }: { albums: Album[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const value = name.trim();
    if (!value) return;
    setError(null);
    startTransition(async () => {
      const result = await createAlbum(value);
      if (result.ok) {
        setName("");
        setCreating(false);
        router.push(`/media/${result.id}`);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-title">Media</h1>
          <p className="text-body text-ink-soft mt-1">Albums of photos your boards can show.</p>
        </div>
        {!creating && (
          <button type="button" className={buttonClassName("primary")} onClick={() => setCreating(true)}>
            New album
          </button>
        )}
      </div>

      {creating && (
        <div className="rounded-panel border-rule bg-surface mt-6 flex flex-wrap items-center gap-2 border p-3">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
              if (event.key === "Escape") setCreating(false);
            }}
            maxLength={120}
            placeholder="Kiddush photos"
            className="rounded-control border-rule-firm bg-paper text-body text-ink h-8 min-w-64 flex-1 border px-2"
          />
          <Button type="button" variant="primary" disabled={pending} onClick={submit}>
            {pending ? "Adding" : "Add album"}
          </Button>
          <button type="button" className={buttonClassName("tertiary")} onClick={() => setCreating(false)}>
            Cancel
          </button>
          {error && (
            <p role="alert" className="text-meta text-offline w-full">
              {error}
            </p>
          )}
        </div>
      )}

      {albums.length === 0 && !creating ? (
        <div className="rounded-panel border-rule bg-surface mt-6 border p-8">
          <h2 className="text-section">Add your first album</h2>
          <p className="text-body text-ink-soft mt-1 max-w-prose">
            An album holds photos. A Gallery or Collage widget points at an album and shows its photos on a board, so
            adding photos to the album updates the board without touching the design.
          </p>
          <button type="button" className={`${buttonClassName("primary")} mt-4`} onClick={() => setCreating(true)}>
            New album
          </button>
        </div>
      ) : (
        albums.length > 0 && (
          <div className="rounded-panel border-rule bg-surface mt-6 overflow-hidden border">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-rule-firm text-meta text-ink-soft border-b text-left">
                  <th className="px-4 py-2 font-normal">Album</th>
                  <th className="px-4 py-2 text-right font-normal">Photos</th>
                  <th className="w-40 px-4 py-2 font-normal">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {albums.map((album) => (
                  <AlbumRow key={album.id} album={album} onOpen={() => router.push(`/media/${album.id}`)} onDeleted={() => router.refresh()} />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}

/** One album in the list. Hover (or focus) reveals Delete; deleting asks first,
 *  in the row itself, and says what happens to the photos. */
function AlbumRow({ album, onOpen, onDeleted }: { album: Album; onOpen: () => void; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (confirming) {
    return (
      <tr className="bg-verdigris-wash/40 border-rule border-b last:border-0">
        <td colSpan={3} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-cell text-ink">
              Delete &ldquo;{album.name}&rdquo;? Its photos go too, except any that are also in another album.
            </span>
            <Button
              className="text-offline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await deleteAlbum(album.id);
                  if (result.ok) onDeleted();
                  else setError(result.error);
                })
              }
            >
              {pending ? "Deleting" : "Delete album"}
            </Button>
            <Button variant="tertiary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            {error && <span className="text-meta text-offline">{error}</span>}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr onClick={onOpen} className="group hover:bg-verdigris-wash/40 border-rule cursor-pointer border-b last:border-0">
      <td className="text-body text-ink px-4 py-3">{album.name}</td>
      <td className="text-body text-ink-soft numeric px-4 py-3 text-right">{album.count}</td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setConfirming(true);
          }}
          className="text-meta text-offline invisible rounded-control px-2 py-1 group-hover:visible focus:visible"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
