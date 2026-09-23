"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { uploadPhoto, type UploadStage } from "@/lib/media/upload";
import { formatDate, isShowing, todayIn } from "@/lib/media/visibility";
import { backfillPhotoSizes, deleteAssets, setCaption, setDisplayUntil } from "../actions";

export type AlbumPhoto = {
  assetId: string;
  caption: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  /** Last date boards show it (album_items.display_until), or null. */
  displayUntil: string | null;
};

/** Two at a time: quick on a good connection, gentle on a shul's slow one, and
 *  each tile still visibly finishes before the next starts on that lane. */
const UPLOAD_LANES = 2;

type QueueItem = {
  id: string;
  file: File;
  /** A local preview, so the tile shows the actual photo before it's uploaded. */
  preview: string;
  status: "waiting" | "working" | "done" | "failed";
  stage: UploadStage | null;
  progress: number;
  deduped: boolean;
  error: string | null;
};

const STAGE_LABEL: Record<UploadStage, string> = {
  reading: "Reading",
  resizing: "Resizing",
  uploading: "Uploading",
  saving: "Saving",
};

export function AlbumDetail({
  albumId,
  albumName,
  orgId,
  timeZone,
  photos,
  nextPosition,
}: {
  albumId: string;
  albumName: string;
  orgId: string;
  timeZone: string;
  photos: AlbumPhoto[];
  nextPosition: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const positionRef = useRef(nextPosition);

  // A photo stored before sizes were recorded can't be laid out by a collage
  // (it arranges by aspect ratio), so fill the gap from the photo's own file.
  // Once per album visit; the action only touches rows still missing a size.
  const missingSizes = photos.some((photo) => !photo.width || !photo.height);
  useEffect(() => {
    if (!missingSizes) return;
    let cancelled = false;
    backfillPhotoSizes(albumId).then((result) => {
      if (!cancelled && result.ok && result.updated > 0) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [albumId, missingSizes, router]);

  const uploading = queue.some((item) => item.status === "waiting" || item.status === "working");

  // Leaving mid-upload loses the photos still in the queue — say so.
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const update = (id: string, patch: Partial<QueueItem>) =>
    setQueue((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const handleFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((file) => file.type.startsWith("image/") || /\.(hei[cf])$/i.test(file.name));
    if (list.length === 0) return;

    const added: QueueItem[] = list.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      status: "waiting",
      stage: null,
      progress: 0,
      deduped: false,
      error: null,
    }));
    const positions = new Map(added.map((item) => [item.id, positionRef.current++]));
    setQueue((items) => [...items.filter((item) => item.status !== "done"), ...added]);

    const pending = [...added];
    const lane = async () => {
      for (let item = pending.shift(); item; item = pending.shift()) {
        const id = item.id;
        update(id, { status: "working", stage: "reading", progress: 0.02 });
        const result = await uploadPhoto({
          file: item.file,
          orgId,
          albumId,
          position: positions.get(id)!,
          onProgress: (stage, progress) => update(id, { stage, progress }),
        });
        update(
          id,
          result.ok
            ? { status: "done", progress: 1, deduped: result.deduped }
            : { status: "failed", error: result.error },
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_LANES, added.length) }, lane));
    router.refresh();
    // The uploaded photos are in the grid now; clear their tiles (failures stay
    // until dismissed, so the reason is still on screen).
    setTimeout(() => {
      setQueue((items) => {
        for (const item of items) if (item.status === "done") URL.revokeObjectURL(item.preview);
        return items.filter((item) => item.status !== "done");
      });
    }, 1500);
  };

  const dismissFailures = () =>
    setQueue((items) => {
      for (const item of items) if (item.status === "failed") URL.revokeObjectURL(item.preview);
      return items.filter((item) => item.status !== "failed");
    });

  const toggle = (assetId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });

  const today = todayIn(timeZone);

  return (
    <>
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link href="/media" className="text-meta text-ink-soft hover:text-ink">
            ← Media
          </Link>
          <h1 className="text-title mt-1">{albumName}</h1>
        </div>
      </div>

      {/* The dropzone IS the feature — plan.md §6: "since upload is the only
          path, the upload UX is the feature." Drag, or click to choose. */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
        className={`rounded-panel mt-6 flex w-full flex-col items-center justify-center gap-1 border border-dashed px-6 py-10 text-center ${
          dragging ? "border-verdigris bg-verdigris-wash/50" : "border-rule-firm bg-surface"
        }`}
      >
        <span className="text-body text-ink">
          {uploading ? "Drop more photos to add them to the queue" : "Drop photos here, or click to choose"}
        </span>
        <span className="text-meta text-ink-soft">
          JPEG, PNG, WebP or GIF. iPhone HEIC isn&rsquo;t supported yet — export as JPEG first.
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {queue.length > 0 && <UploadQueue queue={queue} onDismiss={dismissFailures} />}

      {photos.length > 0 && (
        <SelectionBar
          albumId={albumId}
          total={photos.length}
          selected={selected}
          today={today}
          onSelectAll={() => setSelected(new Set(photos.map((photo) => photo.assetId)))}
          onClear={() => setSelected(new Set())}
          onDone={() => {
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}

      {photos.length === 0 ? (
        queue.length === 0 && <p className="text-body text-ink-soft mt-6">No photos yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-album-grid>
          {photos.map((photo) => (
            <PhotoCell
              key={photo.assetId}
              albumId={albumId}
              photo={photo}
              today={today}
              selected={selected.has(photo.assetId)}
              selecting={selected.size > 0}
              onToggle={() => toggle(photo.assetId)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** The upload in progress: an overall bar, then a tile per photo showing the
 *  photo itself, what it's doing right now, and its own bar. */
function UploadQueue({ queue, onDismiss }: { queue: QueueItem[]; onDismiss: () => void }) {
  const done = queue.filter((item) => item.status === "done").length;
  const failed = queue.filter((item) => item.status === "failed").length;
  const active = queue.length - done - failed;
  const overall = queue.reduce((sum, item) => sum + (item.status === "failed" ? 1 : item.progress), 0) / queue.length;

  const heading =
    active > 0
      ? `Uploading ${queue.length} ${queue.length === 1 ? "photo" : "photos"} — ${done} done`
      : failed > 0
        ? `${done} added, ${failed} couldn’t be uploaded`
        : `${done} ${done === 1 ? "photo" : "photos"} added`;

  return (
    <section className="rounded-panel border-rule bg-surface mt-4 border p-4" aria-live="polite" data-upload-queue>
      <div className="mb-2 flex items-center justify-between gap-4">
        <h2 className="text-heading text-ink font-semibold">{heading}</h2>
        <span className="text-meta text-ink-soft numeric">{Math.round(overall * 100)}%</span>
      </div>
      <ProgressBar value={overall} label="Upload progress" />

      <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {queue.map((item) => (
          <li key={item.id} className="flex flex-col gap-1" data-upload-item={item.status}>
            <div className="rounded-panel border-rule bg-paper relative aspect-square overflow-hidden border">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL preview. */}
              <img
                src={item.preview}
                alt=""
                className={`h-full w-full object-cover ${item.status === "done" ? "" : "opacity-50"}`}
              />
              {item.status === "done" && (
                <span className="bg-live text-surface rounded-control absolute top-1 right-1 flex size-6 items-center justify-center text-[13px]">
                  ✓
                </span>
              )}
              {item.status !== "failed" && (
                <div className="absolute inset-x-2 bottom-2">
                  <ProgressBar value={item.progress} label={`${item.file.name} progress`} />
                </div>
              )}
            </div>
            <span className="text-meta text-ink truncate" title={item.file.name}>
              {item.file.name}
            </span>
            <span className={`text-meta ${item.status === "failed" ? "text-offline" : "text-ink-soft"}`}>
              {item.status === "waiting" && "Waiting"}
              {item.status === "working" && `${item.stage ? STAGE_LABEL[item.stage] : "Starting"}…`}
              {item.status === "done" && (item.deduped ? "Already in Media — added" : "Added")}
              {item.status === "failed" && item.error}
            </span>
          </li>
        ))}
      </ul>

      {active === 0 && failed > 0 && (
        <Button className="mt-3" onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </section>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="bg-rule rounded-control h-1.5 w-full overflow-hidden"
    >
      <div className="bg-verdigris h-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** What you can do with the photos you've picked: delete them, or set the last
 *  day boards show them (they stay in the album). */
function SelectionBar({
  albumId,
  total,
  selected,
  today,
  onSelectAll,
  onClear,
  onDone,
}: {
  albumId: string;
  total: number;
  selected: Set<string>;
  today: string;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState(today);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = useMemo(() => [...selected], [selected]);
  const count = ids.length;
  const noun = count === 1 ? "photo" : "photos";

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      onDone();
    });

  if (count === 0) {
    return (
      <div className="mt-6 flex items-center justify-between gap-4">
        <span className="text-meta text-ink-soft">
          {total} {total === 1 ? "photo" : "photos"}. Tick photos to delete them or set when they stop showing.
        </span>
        <Button variant="tertiary" onClick={onSelectAll}>
          Select all
        </Button>
      </div>
    );
  }

  return (
    <div
      className="rounded-panel border-rule-firm bg-verdigris-wash sticky top-0 z-10 mt-6 flex flex-wrap items-center gap-3 border px-4 py-3"
      data-selection-bar
    >
      <span className="text-cell text-ink font-semibold">
        {count} {noun} selected
      </span>
      <Button variant="tertiary" onClick={count === total ? onClear : onSelectAll}>
        {count === total ? "Clear" : "Select all"}
      </Button>
      {count !== total && (
        <Button variant="tertiary" onClick={onClear}>
          Clear
        </Button>
      )}

      <span className="bg-rule-firm mx-1 hidden h-6 w-px sm:block" aria-hidden />

      <label className="text-meta text-ink-soft flex items-center gap-2">
        Stop showing after
        <input
          type="date"
          value={date}
          min={today}
          onChange={(event) => setDate(event.target.value)}
          className="rounded-control border-rule-firm bg-surface text-cell text-ink h-8 border px-2"
        />
      </label>
      <Button disabled={pending || !date} onClick={() => run(() => setDisplayUntil(albumId, ids, date))}>
        Set end date
      </Button>
      <Button disabled={pending} onClick={() => run(() => setDisplayUntil(albumId, ids, null))}>
        Keep showing
      </Button>

      <span className="ml-auto flex items-center gap-2">
        {confirming ? (
          <>
            <span className="text-meta text-ink">
              Delete {count} {noun}? {count === 1 ? "It" : "They"} leave every album and board.
            </span>
            <Button className="text-offline" disabled={pending} onClick={() => run(() => deleteAssets(albumId, ids))}>
              Delete
            </Button>
            <Button variant="tertiary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button className="text-offline" onClick={() => setConfirming(true)}>
            Delete {count} {noun}
          </Button>
        )}
      </span>
      {error && <p className="text-meta text-offline w-full">{error}</p>}
    </div>
  );
}

function PhotoCell({
  albumId,
  photo,
  today,
  selected,
  selecting,
  onToggle,
}: {
  albumId: string;
  photo: AlbumPhoto;
  today: string;
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
}) {
  const [caption, setCaptionText] = useState(photo.caption);
  const [, startTransition] = useTransition();
  const ended = !isShowing(photo.displayUntil, today);

  const commitCaption = () => {
    if (caption === photo.caption) return;
    startTransition(async () => {
      await setCaption(albumId, photo.assetId, caption);
    });
  };

  return (
    <div className="group relative flex flex-col gap-1" data-photo={photo.assetId} data-selected={selected || undefined}>
      <div
        className={`rounded-panel bg-paper relative aspect-square overflow-hidden border ${
          selected ? "border-verdigris outline-verdigris outline-2" : "border-rule"
        }`}
      >
        {/* A click on the photo selects it once anything is selected, so picking
            many is click, click, click rather than hunting for checkboxes. */}
        <button
          type="button"
          onClick={selecting ? onToggle : undefined}
          tabIndex={selecting ? 0 : -1}
          className={`block h-full w-full ${selecting ? "cursor-pointer" : "cursor-default"}`}
          aria-label={selecting ? (selected ? "Deselect photo" : "Select photo") : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- proxy path, not a
              Next-optimizable asset, and the same <img> the board renderer uses. */}
          <img
            src={photo.thumbUrl}
            alt={photo.caption || "Photo"}
            className={`h-full w-full object-cover ${ended ? "opacity-40" : ""}`}
          />
        </button>
        {/* Always visible: hover-only checkboxes don't exist on a tablet, and a
            gabbai shouldn't have to discover that photos can be picked. */}
        <label className="bg-surface/90 rounded-control absolute top-1.5 left-1.5 flex size-7 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={selected ? "Deselect photo" : "Select photo"}
            className="accent-verdigris size-4"
          />
        </label>
        {photo.displayUntil && (
          <span
            className={`rounded-control text-meta absolute right-1.5 bottom-1.5 px-1.5 py-0.5 ${
              ended ? "bg-ink text-paper" : "bg-surface/90 text-ink"
            }`}
          >
            {ended ? `Stopped after ${formatDate(photo.displayUntil)}` : `Shows until ${formatDate(photo.displayUntil)}`}
          </span>
        )}
      </div>
      <input
        value={caption}
        onChange={(event) => setCaptionText(event.target.value)}
        onBlur={commitCaption}
        placeholder="Add a caption"
        maxLength={300}
        className="text-meta text-ink placeholder:text-ink-faint rounded-control hover:border-rule focus:border-rule-firm w-full border border-transparent bg-transparent px-1 py-0.5"
      />
    </div>
  );
}
