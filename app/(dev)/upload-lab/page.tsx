"use client";

/*
 * The photo upload, run for real in a browser against a recording fake of
 * Supabase — what scripts/test-upload-browser.mjs drives. The real pipeline
 * (lib/media/upload.ts) decodes, resizes and encodes with the browser's own
 * canvas, so it can only be tested in one; the fake stands in for the network
 * so each failure — a size that won't upload, an album link refused, a second
 * tab mid-upload — can be forced and what the upload did about it read back.
 *
 * Nothing here reaches a real project: the fake answers every call itself.
 */

import { useEffect } from "react";
import { uploadPhoto, type UploadResult } from "@/lib/media/upload";

type Call = { op: string; table?: string; bucket?: string; detail: unknown };

export type LabScenario = {
  /** The photo's pixel size. */
  width: number;
  height: number;
  /** A row the dedup lookup finds. */
  existing?: { id: string; status: string; created_at: string } | null;
  /** Fail the Nth Storage upload (0-based). */
  failUploadAt?: number;
  /** Refuse the album link. */
  failLink?: boolean;
  /** Make the pending insert fail with this code. */
  insertErrorCode?: string;
  /** Make the canvas report this type instead of WebP. */
  encodeAs?: string;
};

function fakeClient(scenario: LabScenario, calls: Call[]) {
  let uploads = 0;
  const builder = (table: string) => {
    let op = "select";
    let detail: unknown = null;
    const filters: [string, unknown][] = [];
    const resolve = () => {
      calls.push({ op, table, detail: { payload: detail, filters } });
      if (op === "insert" && table === "assets" && scenario.insertErrorCode) {
        return { data: null, error: { code: scenario.insertErrorCode, message: "duplicate key" } };
      }
      if (op === "insert" && table === "album_items" && scenario.failLink) {
        return { data: null, error: { code: "42501", message: "not allowed" } };
      }
      if (op === "select") return { data: scenario.existing ?? null, error: null };
      return { data: null, error: null };
    };
    const chain = {
      select(columns: string) {
        op = "select";
        detail = columns;
        return chain;
      },
      insert(row: unknown) {
        op = "insert";
        detail = row;
        return chain;
      },
      update(patch: unknown) {
        op = "update";
        detail = patch;
        return chain;
      },
      eq: (column: string, value: unknown) => (filters.push([`eq:${column}`, value]), chain),
      neq: (column: string, value: unknown) => (filters.push([`neq:${column}`, value]), chain),
      is: (column: string, value: unknown) => (filters.push([`is:${column}`, value]), chain),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };
    return chain;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "a1111111-1111-4111-8111-111111111111" } } }) },
    from: builder,
    storage: {
      from: (bucket: string) => ({
        async upload(path: string, blob: Blob, options: unknown) {
          const index = uploads++;
          calls.push({ op: "upload", bucket, detail: { path, type: blob.type, bytes: blob.size, options } });
          if (index === scenario.failUploadAt) return { data: null, error: { message: "network dropped" } };
          return { data: { path }, error: null };
        },
        async remove(paths: string[]) {
          calls.push({ op: "remove", bucket, detail: paths });
          return { data: paths.map((name) => ({ name })), error: null };
        },
      }),
    },
  };
}

async function samplePhoto(width: number, height: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#335");
  gradient.addColorStop(1, "#c96");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  // A little per-run noise so two runs never share a checksum by accident.
  ctx.fillStyle = "#fff";
  ctx.fillRect(Math.random() * width, Math.random() * height, 4, 4);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9));
  return new File([blob], "kiddush.jpg", { type: "image/jpeg" });
}

async function run(scenario: LabScenario): Promise<{ result: UploadResult; calls: Call[] }> {
  const calls: Call[] = [];
  const file = await samplePhoto(scenario.width, scenario.height);
  const restore = HTMLCanvasElement.prototype.toBlob;
  if (scenario.encodeAs) {
    // Old Safari: asked for WebP, it quietly hands back a PNG.
    const forced = scenario.encodeAs;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      return restore.call(this, callback, type === "image/webp" ? forced : type, quality);
    };
  }
  try {
    const result = await uploadPhoto({
      file,
      orgId: "0e000000-0000-4000-8000-000000000001",
      albumId: "ab000000-0000-4000-8000-000000000001",
      position: 1,
      supabase: fakeClient(scenario, calls) as unknown as NonNullable<Parameters<typeof uploadPhoto>[0]["supabase"]>,
    });
    return { result, calls };
  } finally {
    HTMLCanvasElement.prototype.toBlob = restore;
  }
}

declare global {
  interface Window {
    __uploadLab?: { run: typeof run };
  }
}

export default function UploadLab() {
  useEffect(() => {
    window.__uploadLab = { run };
    document.body.dataset.uploadLab = "ready";
  }, []);
  return <p style={{ padding: 16 }}>Upload lab. Driven by scripts/test-upload-browser.mjs.</p>;
}
