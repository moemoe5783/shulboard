import type { BoardDoc, BoardWidget } from "@/lib/board-doc";

/*
 * The undo stack — plan.md §4b, "a command stack (~50 deep), implement from the
 * start, not later".
 *
 * A COMMAND, NOT A SNAPSHOT. Snapshotting the whole document on every gesture is
 * four lines shorter and wrong at this scale: a board document may be a megabyte
 * (MAX_DOC_BYTES), and fifty of them is fifty megabytes of tab memory to make
 * Ctrl+Z work. A command stores only the widgets a gesture touched, so nudging
 * one widget costs one widget twice over, whatever else is on the board.
 *
 * Every command is a pair of patches. Applying `forward` does the thing;
 * applying `backward` undoes it. Both are expressed the same way — upsert these
 * widget records, delete these ids — which means one apply function serves undo,
 * redo, and the original edit, and there is no separate inverse-operation
 * implementation to drift out of step with the operations themselves.
 */

export const HISTORY_LIMIT = 50;

export type Patch = {
  /** Widget records to write, replacing any existing record with the same id. */
  upserts: BoardWidget[];
  /** Widget ids to remove. */
  deletes: string[];
};

export type Command = {
  /** Shown in the editor. Also what makes a stack readable while debugging. */
  label: string;
  forward: Patch;
  backward: Patch;
};

export type History = {
  past: Command[];
  future: Command[];
};

export const emptyHistory = (): History => ({ past: [], future: [] });

export function applyPatch(doc: BoardDoc, patch: Patch): BoardDoc {
  const deletes = new Set(patch.deletes);
  const upserts = new Map(patch.upserts.map((widget) => [widget.id, widget]));

  const widgets: BoardWidget[] = [];

  for (const widget of doc.widgets) {
    if (deletes.has(widget.id)) continue;
    const replacement = upserts.get(widget.id);
    if (replacement) {
      widgets.push(replacement);
      upserts.delete(widget.id);
    } else {
      widgets.push(widget);
    }
  }

  // Anything left in `upserts` is new. Appended in the order given, so a paste
  // of three widgets keeps their order.
  for (const widget of upserts.values()) widgets.push(widget);

  return { ...doc, widgets };
}

/**
 * Work out what changed, and how to put it back.
 *
 * Comparison is by reference first: a mutation that returns the same widget
 * object for an untouched widget costs nothing here. Deep equality is the
 * fallback for a mutation that rebuilt every record — cheaper than asking every
 * caller to be careful about identity.
 */
export function diff(
  before: BoardWidget[],
  after: BoardWidget[],
): { forward: Patch; backward: Patch } {
  const beforeById = new Map(before.map((widget) => [widget.id, widget]));
  const afterById = new Map(after.map((widget) => [widget.id, widget]));

  const forward: Patch = { upserts: [], deletes: [] };
  const backward: Patch = { upserts: [], deletes: [] };

  for (const widget of after) {
    const previous = beforeById.get(widget.id);
    if (!previous) {
      forward.upserts.push(widget);
      backward.deletes.push(widget.id);
    } else if (previous !== widget && !sameWidget(previous, widget)) {
      forward.upserts.push(widget);
      backward.upserts.push(previous);
    }
  }

  for (const widget of before) {
    if (!afterById.has(widget.id)) {
      forward.deletes.push(widget.id);
      backward.upserts.push(widget);
    }
  }

  return { forward, backward };
}

export const isEmptyPatch = (patch: Patch) =>
  patch.upserts.length === 0 && patch.deletes.length === 0;

function sameWidget(a: BoardWidget, b: BoardWidget): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    a.rotation === b.rotation &&
    a.z === b.z &&
    a.locked === b.locked &&
    a.hidden === b.hidden &&
    a.opacity === b.opacity &&
    a.groupId === b.groupId &&
    a.type === b.type &&
    // Settings and style are opaque records, so this is the one part that has to
    // be compared by value. They are small and this runs once per commit.
    JSON.stringify(a.config) === JSON.stringify(b.config) &&
    JSON.stringify(a.styleOverrides) === JSON.stringify(b.styleOverrides)
  );
}

/** Push a command, dropping the oldest once the stack is full. */
export function push(history: History, command: Command): History {
  const past = [...history.past, command];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    // Any new edit abandons the redo branch. Keeping it would let redo apply a
    // patch against widgets that no longer exist.
    future: [],
  };
}
