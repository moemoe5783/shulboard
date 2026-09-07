"use client";

import { BoardRenderer } from "@/components/board/BoardRenderer";
import { DEMO_CANVAS, demoBoardDoc } from "@/lib/demo-board";

/*
 * The board, on a wall.
 *
 * THE SAME COMPONENT THE EDITOR USES, given the same document. That is the whole
 * point of the task and the reason plan.md §2 says to enforce it in the folder
 * layout: two tabs, one on /editor-lab and one here, must show the same board.
 *
 * The document is hardcoded for now — the bundle endpoint is P3. Nothing here
 * reads a Supabase key of any kind, which is the rule for everything under
 * app/s/.
 *
 * LETTERBOXED IN CSS, NO JAVASCRIPT. The board keeps its aspect ratio and takes
 * as much of the screen as that allows. A display that had to measure the
 * viewport before it could draw would show a black rectangle on every boot,
 * which is the one thing a screen in a lobby must never do.
 */

export function DisplayBoard() {
  const doc = demoBoardDoc();

  return (
    <div className="bg-ink flex h-screen w-screen items-center justify-center overflow-hidden">
      <BoardRenderer
        doc={doc}
        canvas={DEMO_CANVAS}
        style={{
          aspectRatio: `${DEMO_CANVAS.width} / ${DEMO_CANVAS.height}`,
          width: `min(100vw, calc(100vh * ${DEMO_CANVAS.width} / ${DEMO_CANVAS.height}))`,
        }}
      />
    </div>
  );
}
