"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Table } from "@/components/Table";
import { deletePhotosPermanently, restoreAlbum, restorePhotos, type RestoreResult } from "../trash-actions";

/*
 * Recently deleted — a table of records like every other list (design.md §5).
 * Tick photos to restore or permanently delete several at once; each row can
 * do either on its own. Deleting for good is behind a confirmation that says
 * it can't be undone.
 */

export type DeletedPhoto = {
  id: string;
  name: string;
  album: string | null;
  thumbUrl: string | null;
  deletedOn: string;
  daysLeft: number;
};

export type DeletedAlbum = { id: string; name: string; deletedOn: string; daysLeft: number };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "In 12 days", or "Tonight" on the last day — the cleanup runs overnight. */
const countdown = (days: number) => (days <= 0 ? "Tonight" : `In ${plural(days, "day", "days")}`);

function restoredMessage(result: Extract<RestoreResult, { ok: true }>, what: string): string {
  const parts = [`Restored ${what}.`];
  if (result.albumsRestored.length > 0) {
    parts.push(`${result.albumsRestored.map((name) => `“${name}”`).join(", ")} ${result.albumsRestored.length === 1 ? "is" : "are"} back in Media too.`);
  }
  if (result.conflicts.length > 0) {
    parts.push(
      `${result.conflicts.join(", ")} ${result.conflicts.length === 1 ? "wasn't" : "weren't"} restored: the same photo is already in Media.`,
    );
  }
  return parts.join(" ");
}

export function RecentlyDeleted({
  photos,
  albums,
  retentionDays,
}: {
  photos: DeletedPhoto[];
  albums: DeletedAlbum[];
  retentionDays: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Which control started the running action, so that one shows the spinner.
  const [running, setRunning] = useState<string | null>(null);
  const busy = (key: string) => pending && running === key;

  const visible = useMemo(() => new Set(photos.map((photo) => photo.id)), [photos]);
  const picked = [...selected].filter((id) => visible.has(id));

  const run = (key: string, action: () => Promise<string | { error: string }>) => {
    setRunning(key);
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const outcome = await action();
      if (typeof outcome === "string") {
        setMessage(outcome);
        setSelected(new Set());
        setConfirming(null);
        router.refresh();
      } else {
        setError(outcome.error);
      }
    });
  };

  const restore = (ids: string[], key: string) =>
    run(key, async () => {
      const result = await restorePhotos(ids);
      if (!result.ok) return { error: result.error };
      return restoredMessage(result, plural(result.restored, "photo", "photos"));
    });

  const deleteForGood = (ids: string[], key: string) =>
    run(key, async () => {
      const result = await deletePhotosPermanently(ids);
      if (!result.ok) return { error: result.error };
      const done = `Deleted ${plural(result.deleted, "photo", "photos")} for good.`;
      return result.failed > 0
        ? `${done} ${plural(result.failed, "photo", "photos")} couldn't be deleted and ${result.failed === 1 ? "stays" : "stay"} here; try again later.`
        : done;
    });

  const selectAll = () => setSelected(new Set(photos.map((photo) => photo.id)));

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div>
        <Link href="/media" className="text-meta text-verdigris">
          Media
        </Link>
        <h1 className="text-title mt-1">Recently deleted</h1>
        <p className="text-body text-ink-soft mt-1 max-w-prose">
          Deleted photos and albums stay here for {retentionDays} days, then they&rsquo;re deleted for good. Boards
          don&rsquo;t show them in the meantime.
        </p>
      </div>

      {(message || error) && (
        <p className={`text-body mt-4 ${error ? "text-offline" : "text-ink"}`} role={error ? "alert" : "status"}>
          {error ?? message}
        </p>
      )}

      {albums.length > 0 && (
        <section className="mt-8" aria-labelledby="deleted-albums">
          <h2 id="deleted-albums" className="text-heading">
            Albums
          </h2>
          <p className="text-meta text-ink-soft mt-1">Restoring an album brings back the photos that were deleted with it.</p>
          <div className="rounded-panel border-rule bg-surface mt-3 border">
            <Table
              caption="Deleted albums"
              rows={albums}
              rowKey={(album) => album.id}
              empty={{ title: "No deleted albums", description: "" }}
              columns={[
                { key: "name", label: "Album", cell: (album) => <span className="text-cell text-ink">{album.name}</span> },
                { key: "deleted", label: "Deleted", hideBelow: "sm", cell: (album) => album.deletedOn },
                { key: "left", label: "Deleted for good", cell: (album) => countdown(album.daysLeft) },
                {
                  key: "actions",
                  label: "",
                  align: "right",
                  cell: (album) => (
                    <Button
                      variant="tertiary"
                      busy={busy(`album:${album.id}`)}
                      disabled={pending}
                      onClick={() =>
                        run(`album:${album.id}`, async () => {
                          const result = await restoreAlbum(album.id);
                          if (!result.ok) return { error: result.error };
                          return restoredMessage(
                            { ...result, albumsRestored: [] },
                            `“${album.name}” and ${plural(result.restored, "photo", "photos")}`,
                          );
                        })
                      }
                    >
                      {busy(`album:${album.id}`) ? "Restoring" : "Restore"}
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        </section>
      )}

      <section className="mt-8" aria-labelledby="deleted-photos">
        <h2 id="deleted-photos" className="text-heading">
          Photos
        </h2>

        {photos.length > 0 && picked.length === 0 && (
          <div className="mt-3 flex items-center justify-between gap-4">
            <span className="text-meta text-ink-soft">
              {plural(photos.length, "photo", "photos")}. Tick photos to restore them or delete them for good.
            </span>
            <Button variant="tertiary" onClick={selectAll}>
              Select all
            </Button>
          </div>
        )}

        {picked.length > 0 && (
          <div
            className="rounded-panel border-rule-firm bg-verdigris-wash sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-3 border px-4 py-3"
            data-selection-bar
          >
            <span className="text-cell text-ink font-semibold">{plural(picked.length, "photo", "photos")} selected</span>
            {picked.length < photos.length && (
              <Button variant="tertiary" disabled={pending} onClick={selectAll}>
                Select all
              </Button>
            )}
            <Button variant="tertiary" disabled={pending} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <Button busy={busy("bulk:restore")} disabled={pending} onClick={() => restore(picked, "bulk:restore")}>
                {busy("bulk:restore") ? "Restoring" : `Restore ${plural(picked.length, "photo", "photos")}`}
              </Button>
              <Button className="text-offline" disabled={pending} onClick={() => setConfirming(picked)}>
                Delete for good
              </Button>
            </span>
          </div>
        )}

        {confirming && (
          <div
            className="rounded-panel border-rule-firm bg-surface mt-3 flex max-w-xl flex-col gap-2 border p-3"
            role="alertdialog"
            aria-label="Delete for good"
          >
            <p className="text-body text-ink">
              Delete {plural(confirming.length, "photo", "photos")} for good? This can&rsquo;t be undone.
            </p>
            <div className="flex gap-2">
              <Button className="text-offline" busy={busy("confirm")} disabled={pending} onClick={() => deleteForGood(confirming, "confirm")}>
                {busy("confirm") ? "Deleting" : "Delete for good"}
              </Button>
              <Button variant="tertiary" disabled={pending} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-panel border-rule bg-surface mt-3 border">
          <Table
            caption="Deleted photos"
            rows={photos}
            rowKey={(photo) => photo.id}
            empty={{
              title: "Nothing deleted",
              description: `Photos you delete in Media stay here for ${retentionDays} days so you can put them back.`,
            }}
            columns={[
              {
                key: "select",
                label: "",
                width: "w-10",
                cell: (photo) => (
                  <input
                    type="checkbox"
                    checked={selected.has(photo.id)}
                    onChange={() => toggle(photo.id)}
                    aria-label={`Select ${photo.name}`}
                    className="accent-verdigris h-4 w-4"
                  />
                ),
              },
              {
                key: "photo",
                label: "Photo",
                cell: (photo) => (
                  <span className="flex items-center gap-3 py-1">
                    {photo.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a signed Storage URL, not an app asset
                      <img src={photo.thumbUrl} alt="" className="rounded-control border-rule h-9 w-12 shrink-0 border object-cover" />
                    ) : (
                      <span className="rounded-control border-rule bg-paper h-9 w-12 shrink-0 border" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="text-cell text-ink block truncate">{photo.name}</span>
                      {photo.album && <span className="text-meta text-ink-soft block truncate">From {photo.album}</span>}
                    </span>
                  </span>
                ),
              },
              { key: "deleted", label: "Deleted", hideBelow: "sm", cell: (photo) => photo.deletedOn },
              { key: "left", label: "Deleted for good", hideBelow: "sm", cell: (photo) => countdown(photo.daysLeft) },
              {
                key: "actions",
                label: "",
                align: "right",
                cell: (photo) => (
                  <span className="flex justify-end gap-1">
                    <Button
                      variant="tertiary"
                      busy={busy(`restore:${photo.id}`)}
                      disabled={pending}
                      onClick={() => restore([photo.id], `restore:${photo.id}`)}
                    >
                      {busy(`restore:${photo.id}`) ? "Restoring" : "Restore"}
                    </Button>
                    <Button
                      variant="tertiary"
                      // Destructive: the status red, over the tertiary's accent.
                      className="text-offline!"
                      disabled={pending}
                      onClick={() => setConfirming([photo.id])}
                      aria-label={`Delete ${photo.name} for good`}
                    >
                      Delete for good
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        </div>
      </section>
    </>
  );
}
