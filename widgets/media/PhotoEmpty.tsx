"use client";

import { boardLength } from "@/lib/board-theme";

/*
 * The empty/loading frame the Gallery and Collage widgets share — the same
 * honest "here's what happened" frame Image and the Hebrew widgets use rather
 * than a blank box (design.md §5 governs the renderer's own chrome, per
 * CLAUDE.md's scope carve-out). Not a widget: no manifest.ts beside it, so the
 * registry never collects it.
 */
export function PhotoEmpty({ canvas, message }: { canvas: { width: number }; message: string }) {
  return (
    <div className="border-current/25 flex h-full w-full items-center justify-center border border-dashed p-2 text-center opacity-60">
      <span style={{ fontSize: boardLength(24, canvas.width) }}>{message}</span>
    </div>
  );
}
