"use client";

import { boardLength } from "@/lib/board-theme";

/*
 * Shared empty state for every widget in this folder that needs real
 * coordinates — plan.md §5: "computed in the browser from lat/long + system
 * clock." Not a widget itself (no manifest.ts/Settings.tsx alongside it, so
 * the registry's require.context in widgets/manifests.ts never sees it) —
 * just the one honest frame five Renderers share, the same way Image's own
 * "no picture" frame is one Renderer's empty state rather than a pattern
 * copied five times with five chances to drift.
 *
 * design.md §5's empty-state rule governs this even though it renders inside
 * a board: CLAUDE.md's scope carve-out is explicit that "the renderer's own
 * chrome (its empty states...)" is chrome, not board content, so this says
 * what happened rather than showing a blank box.
 */
export function EmptyLocation({ canvas, message }: { canvas: { width: number }; message: string }) {
  return (
    <div className="border-current/25 flex h-full w-full items-center justify-center border border-dashed opacity-60">
      <span style={{ fontSize: boardLength(24, canvas.width) }}>{message}</span>
    </div>
  );
}
