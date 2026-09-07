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
 */
export function BoardPicker({
  screenId,
  boards,
  currentBoardId,
}: {
  screenId: string;
  boards: { id: string; name: string }[];
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

  return (
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
            </option>
          ))}
        </SelectField>
      </div>
      <Button type="submit" variant="secondary">
        Show this board
      </Button>
    </form>
  );
}
