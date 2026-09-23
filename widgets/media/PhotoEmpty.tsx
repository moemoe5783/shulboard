"use client";

import { boardLength } from "@/lib/board-theme";

/*
 * The empty/loading frame the Gallery and Collage widgets share — the same
 * honest "here's what happened" frame Image and the Hebrew widgets use rather
 * than a blank box (design.md §5 governs the renderer's own chrome, per
 * CLAUDE.md's scope carve-out). Not a widget: no manifest.ts beside it, so the
 * registry never collects it.
 *
 * `editorOnly` marks it `data-editor-hint`: hidden everywhere except inside the
 * editor's canvas (app/globals.css), so a screen shows nothing where the editor
 * shows the instruction. Same DOM in both places — the difference lives in the
 * editor's wrapper, which is where CLAUDE.md puts every editor/display
 * difference, not in a Renderer prop.
 */
export function PhotoEmpty({
  canvas,
  message,
  editorOnly = false,
}: {
  canvas: { width: number };
  message: string;
  editorOnly?: boolean;
}) {
  return (
    <div
      data-editor-hint={editorOnly ? "" : undefined}
      className="border-current/25 flex h-full w-full items-center justify-center border border-dashed p-2 text-center opacity-60"
    >
      <span style={{ fontSize: boardLength(24, canvas.width) }}>{message}</span>
    </div>
  );
}
