"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { uploadPhoto } from "@/lib/media/upload";
import { backfillPhotoSizes, deleteAsset, setCaption } from "../actions";

export type AlbumPhoto = {
  assetId: string;
  caption: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
};

export function AlbumDetail({
  albumId,
  albumName,
  orgId,
  photos,
  nextPosition,
}: {
  albumId: string;
  albumName: string;
  orgId: string;
  photos: AlbumPhoto[];
  nextPosition: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

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

  const handleFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((file) => file.type.startsWith("image/") || /\.(hei[cf])$/i.test(file.name));
    if (list.length === 0) return;
    setErrors([]);
    setBusy({ done: 0, total: list.length });
    const failures: string[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const result = await uploadPhoto({ file: list[i], orgId, albumId, position: nextPosition + i });
      if (!result.ok) failures.push(result.error);
      setBusy({ done: i + 1, total: list.length });
    }
    setBusy(null);
    setErrors(failures);
    router.refresh();
  };

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
        <span className="text-body text-ink">Drop photos here, or click to choose</span>
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

      {busy && (
        <p className="text-meta text-ink-soft mt-3" role="status">
          Uploading {busy.done} of {busy.total}…
        </p>
      )}
      {errors.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {errors.map((error, index) => (
            <li key={index} className="text-meta text-offline">
              {error}
            </li>
          ))}
        </ul>
      )}

      {photos.length === 0 ? (
        <p className="text-body text-ink-soft mt-6">No photos yet.</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <PhotoCell key={photo.assetId} albumId={albumId} photo={photo} onChanged={() => router.refresh()} />
          ))}
        </div>
      )}
    </>
  );
}

function PhotoCell({
  albumId,
  photo,
  onChanged,
}: {
  albumId: string;
  photo: AlbumPhoto;
  onChanged: () => void;
}) {
  const [caption, setCaptionText] = useState(photo.caption);
  const [pending, startTransition] = useTransition();

  const commitCaption = () => {
    if (caption === photo.caption) return;
    startTransition(async () => {
      await setCaption(albumId, photo.assetId, caption);
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteAsset(photo.assetId, albumId);
      if (result.ok) onChanged();
    });
  };

  return (
    <div className="group relative flex flex-col gap-1">
      <div className="rounded-panel border-rule bg-paper relative aspect-square overflow-hidden border">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxy path, not a
            Next-optimizable asset, and the same <img> the board renderer uses. */}
        <img src={photo.thumbUrl} alt={photo.caption || "Photo"} className="h-full w-full object-cover" />
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label="Delete photo"
          className="bg-ink/70 text-paper absolute top-1 right-1 hidden size-6 items-center justify-center rounded-full text-[13px] group-hover:flex"
        >
          ×
        </button>
      </div>
      <input
        value={caption}
        onChange={(event) => setCaptionText(event.target.value)}
        onBlur={commitCaption}
        placeholder="Add a caption"
        maxLength={300}
        className="text-meta text-ink placeholder:text-ink-faint rounded-control border-transparent hover:border-rule focus:border-rule-firm w-full border bg-transparent px-1 py-0.5"
      />
    </div>
  );
}
