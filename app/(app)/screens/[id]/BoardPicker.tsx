"use client";

import Link from "next/link";
import { Button } from "@/components/Button";
import { SelectField } from "@/components/Field";
import { assignBoard } from "../actions";

/**
 * Wiring a board to a screen — plan.md §1: a screen points at a playlist, not
 * a board, so this is the simplest real thing that could sit on top of that:
 * pick one board, and assignBoard makes (or reuses) the playlist underneath.
 * Multi-board rotation is a later view; this one only ever shows one choice.
 *
 * Assigning an unpublished board is allowed, not a smaller version of the
 * feature blocked outright — someone reasonably wants to point a screen at a
 * board before it's ready to go live. What it must not do is pretend the
 * screen will show something it won't: the notice below says exactly that,
 * and points at the fix.
 */
export function BoardPicker({
  screenId,
  boards,
  currentBoardId,
}: {
  screenId: string;
  boards: { id: string; name: string; published: boolean }[];
  currentBoardId: string | null;
}) {
  if (boards.length === 0) {
    return (
      <p className="text-body text-ink-soft max-w-prose">
        There&rsquo;s nothing to show yet.{" "}
        <Link href="/boards/new" className="text-verdigris">
          Add a board
        </Link>{" "}
        first, then come back and choose it here.
      </p>
    );
  }

  const currentBoard = boards.find((board) => board.id === currentBoardId);

  return (
    <div className="flex flex-col gap-3">
      <form action={assignBoard} className="flex items-end gap-2">
        <input type="hidden" name="screenId" value={screenId} />
        <div className="max-w-64 flex-1">
          <SelectField
            id="boardId"
            name="boardId"
            label="Board"
            defaultValue={currentBoardId ?? ""}
            required
          >
            <option value="" disabled>
              Choose a board
            </option>
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
                {board.published ? "" : " (not published)"}
              </option>
            ))}
          </SelectField>
        </div>
        <Button type="submit" variant="secondary">
          Show this board
        </Button>
      </form>

      {currentBoard && !currentBoard.published && (
        <p className="text-body text-ink-soft max-w-prose">
          {currentBoard.name} hasn&rsquo;t been published, so this screen
          won&rsquo;t show it yet.{" "}
          <Link href={`/boards/${currentBoard.id}`} className="text-verdigris">
            Publish {currentBoard.name}
          </Link>{" "}
          and it&rsquo;ll appear here.
        </p>
      )}
    </div>
  );
}
