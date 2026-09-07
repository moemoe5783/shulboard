"use client";

import { BoardRenderer } from "@/components/board/BoardRenderer";
import type { BundleEnvelope } from "@/lib/bundle/types";

/*
 * The board, on a wall.
 *
 * THE SAME COMPONENT THE EDITOR USES, given a document out of the bundle rather
 * than out of the editor's store. plan.md §2: fork these and WYSIWYG dies.
 *
 * LETTERBOXED IN CSS, NO JAVASCRIPT. The board keeps its aspect ratio and takes
 * as much of the screen as that allows. A display that had to measure the
 * viewport before it could draw would show a black rectangle on every boot,
 * which is the one thing a screen in a lobby must never do.
 */

export function DisplayBoard({ bundle }: { bundle: BundleEnvelope }) {
  // Playlist rotation and dayparting are P6. Until then the screen shows the
  // first board on its playlist, which is what a shul with one board has.
  const boardId = bundle.playlist?.items[0]?.boardId;
  const board = bundle.boards.find((b) => b.id === boardId) ?? bundle.boards[0];

  if (!board) return <WaitingForBoard reason="This screen has no board yet." />;

  const canvas = bundle.screen.canvas;

  return (
    <div className="bg-ink flex h-screen w-screen items-center justify-center overflow-hidden">
      <BoardRenderer
        doc={board.doc}
        canvas={canvas}
        style={{
          aspectRatio: `${canvas.width} / ${canvas.height}`,
          width: `min(100vw, calc(100vh * ${canvas.width} / ${canvas.height}))`,
        }}
      />
    </div>
  );
}

/**
 * Nothing to show yet — a screen paired a moment ago, whose first build has not
 * landed.
 *
 * NOT A SPINNER AND NOT AN ERROR. It is on a wall, and it says the one thing
 * that is true and useful to whoever is standing in front of it. It also stays
 * dark rather than white, because a bright rectangle in a dim lobby is worse
 * than a dark one.
 */
export function WaitingForBoard({ reason }: { reason: string }) {
  return (
    <div className="bg-ink text-paper font-ui flex h-screen w-screen items-center justify-center">
      <p className="text-body opacity-60">{reason}</p>
    </div>
  );
}
