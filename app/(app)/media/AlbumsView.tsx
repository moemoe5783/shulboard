"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonClassName } from "@/components/Button";
import { createAlbum } from "./actions";

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
                </tr>
              </thead>
              <tbody>
                {albums.map((album) => (
                  <tr
                    key={album.id}
                    onClick={() => router.push(`/media/${album.id}`)}
                    className="hover:bg-verdigris-wash/40 border-rule cursor-pointer border-b last:border-0"
                  >
                    <td className="text-body text-ink px-4 py-3">{album.name}</td>
                    <td className="text-body text-ink-soft numeric px-4 py-3 text-right">{album.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
