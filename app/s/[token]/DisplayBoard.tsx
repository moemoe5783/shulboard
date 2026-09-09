"use client";

import { BoardRenderer } from "@/components/board/BoardRenderer";
import type { BoardZmanim } from "@/lib/board-zmanim";
import type { BundleEnvelope } from "@/lib/bundle/types";
import type { ChabadZmanimByDate } from "@/lib/zmanim/resolve";

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
  // Both null, or both real — the bundle resolves screen-then-org already
  // (lib/bundle/build.ts), so there's no partial coordinate to guard against.
  const location =
    bundle.screen.latitude !== null && bundle.screen.longitude !== null && bundle.screen.timezone
      ? { latitude: bundle.screen.latitude, longitude: bundle.screen.longitude, timeZone: bundle.screen.timezone }
      : null;

  // bundle.content.zmanim is already resolved at build time (lib/bundle/
  // build.ts's resolveContent) — raw zmanim_cache rows keyed by date, empty
  // unless the resolved provider is actually Chabad and something on this
  // board needed it. Only the `times` column matters to a widget; the rest
  // (provider, raw_response, fetched_at) stays out of BoardZmanim on
  // purpose, since nothing client-side reads it.
  const chabadZmanim: ChabadZmanimByDate = {};
  for (const [date, row] of Object.entries(bundle.content.zmanim)) {
    const times = (row as { times?: unknown })?.times;
    if (times) chabadZmanim[date] = times as ChabadZmanimByDate[string];
  }

  const zmanim: BoardZmanim = {
    provider: bundle.screen.zmanimProvider,
    hasChabadLocation: bundle.screen.hasChabadLocation,
    chabadZmanim: bundle.screen.zmanimProvider === "chabad" ? chabadZmanim : null,
  };

  return (
    <div className="bg-ink flex h-screen w-screen items-center justify-center overflow-hidden">
      <BoardRenderer
        doc={board.doc}
        canvas={canvas}
        location={location}
        zmanim={zmanim}
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
