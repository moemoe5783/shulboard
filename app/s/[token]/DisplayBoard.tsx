"use client";

import { BoardRenderer } from "@/components/board/BoardRenderer";
import type { BoardFiles } from "@/lib/board-assets";
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

export function DisplayBoard({ bundle, files }: { bundle: BundleEnvelope; files: BoardFiles }) {
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
        albums={bundle.content.albums}
        files={files}
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

/**
 * The first time a screen loads a board — or after it was paired — its
 * pictures are downloaded before the board appears (the atomic swap,
 * lib/display/assets.ts), and then the opening photos of each gallery and
 * collage, with the board already drawn underneath so they know their size. On a slow connection
 * that can still take a while, and a dark screen that says nothing looks
 * broken. This shows that it's
 * loading and how far along it is.
 */
export function LoadingProgress({ done, total, over = false }: { done: number; total: number; over?: boolean }) {
  const pct = total > 0 ? Math.floor((done / total) * 100) : 0;
  return (
    <div
      className={`bg-ink text-paper font-ui flex h-screen w-screen flex-col items-center justify-center gap-[3vh] px-[8vw] ${
        // Over a board already mounted beneath it, whose photos are arriving.
        over ? "fixed inset-0 z-40" : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <p className="text-[clamp(18px,2.4vw,40px)] opacity-80">Loading</p>
      <div className="bg-paper/15 h-[max(6px,0.6vh)] rounded-control w-full max-w-[60vw] overflow-hidden">
        <div className="bg-paper/80 h-full transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="numeric text-[clamp(14px,1.6vw,28px)] opacity-60" data-loading-progress={`${done}/${total}`}>
        {pct}%
      </p>
    </div>
  );
}

/**
 * A board is on the wall and something is downloading behind it — a new
 * version, or the rest of this one's photos. The board keeps running; this
 * small tag in the corner says so, so whoever just published knows the screen
 * heard them. Shown only once an
 * update has taken a few seconds, so a quick one never flashes it.
 */
export function UpdatingBadge({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.floor((done / total) * 100) : 0;
  return (
    <div
      role="status"
      aria-live="polite"
      data-updating-badge
      className="bg-ink/80 text-paper font-ui numeric pointer-events-none fixed right-[1.5vw] bottom-[1.5vw] z-50 rounded-[6px] px-[1vw] py-[0.6vw] text-[clamp(11px,0.9vw,18px)]"
    >
      {label} {pct}%
    </div>
  );
}
