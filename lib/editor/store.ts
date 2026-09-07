import { create } from "zustand";
import {
  boardWidgetSchema,
  emptyBoardDoc,
  parseBoardDoc,
  type BoardDoc,
  type BoardWidget,
} from "@/lib/board-doc";
import {
  alignRects,
  boundingRect,
  distributeRects,
  rectToWidget,
  round,
  widgetRect,
  type AlignEdge,
  type CanvasSize,
  type Rect,
} from "./geometry";
import {
  applyPatch,
  diff,
  emptyHistory,
  isEmptyPatch,
  push,
  type History,
} from "./history";

/*
 * The editor's state — plan.md §4c: "Zustand store holding the board doc + a
 * separate undo stack."
 *
 * Separate is the important word. `doc` is the thing that gets saved; `history`
 * is the thing that lets you take it back, and it never travels with the
 * document. Selection, zoom and the clipboard are session state and belong to
 * neither.
 *
 * EVERY MUTATION GOES THROUGH commit(). It takes the widget list, hands it to a
 * function that returns the next one, diffs the two, and pushes one command. That
 * is what makes undo correct by construction rather than by fifty remembered
 * call sites — and it is why a gesture that touches nothing costs nothing and
 * leaves no entry on the stack for a person to press Ctrl+Z through.
 *
 * Positions live in the document as percentages. Everything below that takes or
 * returns a rectangle works in design units and converts at the boundary, so no
 * caller has to remember which it is holding.
 */

/** A group is a real widget row, because parseBoardDoc requires every groupId to
 *  name a widget on the board. It is never rendered: it exists to carry the
 *  membership and the group's own bounding box. */
export const GROUP_TYPE = "group";

export type EditorState = {
  doc: BoardDoc;
  /** True once load() has run. The transform layer waits for it, because it
   *  needs widget elements in the DOM before it can target any. */
  loaded: boolean;
  canvas: CanvasSize;
  history: History;

  /** Widget ids. Never contains a group widget — selecting a group selects its
   *  members, which are the things a transform actually moves. */
  selection: string[];
  zoom: number;
  /** Snapping is on by default and suspended while Ctrl/Cmd is held (§4b). */
  snapEnabled: boolean;
  gridSize: number;
  showGrid: boolean;

  // ---- selection -------------------------------------------------------
  select: (ids: string[]) => void;
  /** Select these, plus every sibling of any group they belong to. What a click
   *  on the canvas does, wherever the click came from. */
  selectWidgets: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  // ---- view ------------------------------------------------------------
  setZoom: (zoom: number) => void;
  setSnapEnabled: (on: boolean) => void;
  setGridSize: (size: number) => void;
  setShowGrid: (on: boolean) => void;

  // ---- editing ---------------------------------------------------------
  /**
   * Merge `patch` into each target widget's config — the properties panel's
   * one mutation path.
   *
   * Goes through commit() like everything else in this file, so it is live on
   * the canvas the instant it's called and undoable like any other edit. A
   * text field therefore gets one undo entry per keystroke rather than one per
   * editing session — a real but minor rough edge, and a much smaller one than
   * the alternative: an earlier version of this tried to coalesce keystrokes
   * into a single command by applying the patch outside commit() while typing
   * and only running it through commit() on blur, and that is broken by
   * construction. By the time the blur-time commit ran, get().doc already
   * held the typed value from the uncommitted preview writes, so diffing the
   * "old" and "new" widget lists found no difference — isEmptyPatch was true,
   * commit() returned early, and the entire edit silently never reached the
   * undo stack at all. One mutation path, always through commit(), is what
   * keeps that class of bug from coming back.
   */
  setWidgetConfig: (ids: string[], patch: Record<string, unknown>, label?: string) => void;
  /** Commit a transform for one or more widgets, in design units. */
  applyRects: (label: string, rects: Record<string, Rect>) => void;
  applyRotation: (label: string, rotations: Record<string, number>) => void;
  nudge: (dx: number, dy: number) => void;
  /** Put new widgets on the board. One undoable command. */
  addWidgets: (widgets: BoardWidget[], label?: string) => void;
  duplicate: (ids?: string[], offset?: number) => string[];
  /** Alt+drag: leave a copy where the selection started, move the originals. */
  duplicateInPlaceAndMove: (rects: Record<string, Rect>) => void;
  remove: (ids?: string[]) => void;
  setLocked: (ids: string[], locked: boolean) => void;
  setHidden: (ids: string[], hidden: boolean) => void;

  // ---- z-order ---------------------------------------------------------
  bringForward: (ids?: string[]) => void;
  sendBackward: (ids?: string[]) => void;
  bringToFront: (ids?: string[]) => void;
  sendToBack: (ids?: string[]) => void;

  // ---- grouping --------------------------------------------------------
  group: () => void;
  ungroup: () => void;

  // ---- align and distribute -------------------------------------------
  align: (edge: AlignEdge) => void;
  distribute: (axis: "horizontal" | "vertical") => void;

  // ---- clipboard -------------------------------------------------------
  copy: () => void;
  cut: () => void;
  paste: () => void;

  // ---- history ---------------------------------------------------------
  undo: () => void;
  redo: () => void;

  /** Replace the document wholesale. Clears history — the stack's patches refer
   *  to widgets that may not exist in the new document. `canvas` is optional
   *  because the lab always edits the same 1920×1080 demo document; a real
   *  board supplies its own canvas_width/canvas_height. */
  load: (doc: unknown, canvas?: CanvasSize) => void;

  // ---- housekeeping ----------------------------------------------------
  /** Drop selected ids whose widgets no longer exist, after a delete or undo. */
  pruneSelection: () => void;
  /** Re-fit every group's box to its members. Never its own undo entry — it
   *  rides along with whatever command moved the members. */
  refreshGroupBounds: () => void;
};

/**
 * The clipboard.
 *
 * Module scope rather than store state: it is shared across boards (§4b, "copy
 * and paste within and across boards"), and a per-board store would lose it on
 * navigation. A real cross-tab clipboard needs the async Clipboard API and its
 * permission prompt; this is the in-tab half, which is the half the lab needs.
 */
let clipboard: BoardWidget[] = [];

const newId = () => crypto.randomUUID();

export const useEditor = create<EditorState>((set, get) => {
  /**
   * The single mutation path.
   *
   * `mutate` gets the current widgets and returns the next ones. Everything else
   * — diffing, the command, the stack limit, applying — happens here exactly
   * once, so a new operation cannot forget to be undoable.
   */
  function commit(label: string, mutate: (widgets: BoardWidget[]) => BoardWidget[]) {
    const { doc, history } = get();
    const next = mutate(doc.widgets);
    const { forward, backward } = diff(doc.widgets, next);

    if (isEmptyPatch(forward)) return;

    set({
      doc: applyPatch(doc, forward),
      history: push(history, { label, forward, backward }),
    });
  }

  /** The widgets a command acts on: an explicit list, or the selection. */
  const targets = (ids?: string[]) => ids ?? get().selection;

  return {
    doc: emptyBoardDoc(),
    loaded: false,
    canvas: { width: 1920, height: 1080 },
    history: emptyHistory(),

    selection: [],
    zoom: 1,
    snapEnabled: true,
    gridSize: 40,
    showGrid: false,

    select: (ids) => set({ selection: [...new Set(ids)] }),
    selectWidgets: (ids) => set({ selection: expandGroups(get().doc.widgets, ids) }),
    toggleSelected: (id) =>
      set((state) => ({
        selection: state.selection.includes(id)
          ? state.selection.filter((existing) => existing !== id)
          : [...state.selection, id],
      })),
    selectAll: () =>
      set((state) => ({
        selection: state.doc.widgets
          .filter((w) => w.type !== GROUP_TYPE && !w.locked && !w.hidden)
          .map((w) => w.id),
      })),
    clearSelection: () => set({ selection: [] }),

    setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.1, zoom)) }),
    setSnapEnabled: (on) => set({ snapEnabled: on }),
    setGridSize: (size) => set({ gridSize: Math.max(1, Math.round(size)) }),
    setShowGrid: (on) => set({ showGrid: on }),

    setWidgetConfig: (ids, patch, label = "Edit properties") => {
      const chosen = new Set(ids);
      commit(label, (widgets) =>
        widgets.map((w) => (chosen.has(w.id) ? { ...w, config: { ...w.config, ...patch } } : w)),
      );
    },

    applyRects: (label, rects) => {
      const { canvas } = get();
      commit(label, (widgets) =>
        widgets.map((widget) => {
          const rect = rects[widget.id];
          return rect ? { ...widget, ...rectToWidget(rect, canvas) } : widget;
        }),
      );
      get().refreshGroupBounds();
    },

    applyRotation: (label, rotations) => {
      commit(label, (widgets) =>
        widgets.map((widget) => {
          const rotation = rotations[widget.id];
          return rotation === undefined
            ? widget
            : { ...widget, rotation: round(normaliseAngle(rotation)) };
        }),
      );
    },

    nudge: (dx, dy) => {
      const { canvas, selection } = get();
      if (selection.length === 0) return;
      const ids = new Set(selection);

      commit("Nudge", (widgets) =>
        widgets.map((widget) => {
          if (!ids.has(widget.id) || widget.locked) return widget;
          const rect = widgetRect(widget, canvas);
          return {
            ...widget,
            ...rectToWidget({ ...rect, x: rect.x + dx, y: rect.y + dy }, canvas),
          };
        }),
      );
    },

    addWidgets: (added, label = "Add") => {
      if (added.length === 0) return;
      commit(label, (widgets) => [...widgets, ...added]);
      set({ selection: added.filter((w) => w.type !== GROUP_TYPE).map((w) => w.id) });
    },

    duplicate: (ids, offset = 16) => {
      const { canvas } = get();
      const chosen = targets(ids);
      if (chosen.length === 0) return [];

      const copies = copyWidgets(get().doc.widgets, chosen, canvas, offset);
      if (copies.length === 0) return [];

      commit("Duplicate", (widgets) => [...widgets, ...copies]);
      const newIds = copies.filter((w) => w.type !== GROUP_TYPE).map((w) => w.id);
      set({ selection: newIds });
      return newIds;
    },

    duplicateInPlaceAndMove: (rects) => {
      const { canvas, doc } = get();
      const moving = Object.keys(rects);
      if (moving.length === 0) return;

      // The copies stay where the gesture began and the originals travel, which
      // is the same picture as the usual "drag a copy away" and needs no
      // re-targeting of the transform layer half way through a drag.
      const copies = copyWidgets(doc.widgets, moving, canvas, 0);

      commit("Duplicate by dragging", (widgets) => [
        ...widgets.map((widget) => {
          const rect = rects[widget.id];
          return rect ? { ...widget, ...rectToWidget(rect, canvas) } : widget;
        }),
        ...copies,
      ]);
    },

    remove: (ids) => {
      const chosen = new Set(targets(ids));
      if (chosen.size === 0) return;

      commit("Delete", (widgets) => {
        // A group whose members all go should go too, or the document keeps an
        // empty group and parseBoardDoc keeps accepting it forever.
        const remaining = widgets.filter((w) => !chosen.has(w.id));
        const stillUsed = new Set(remaining.map((w) => w.groupId).filter(Boolean) as string[]);
        return remaining.filter((w) => w.type !== GROUP_TYPE || stillUsed.has(w.id));
      });
      set({ selection: [] });
    },

    setLocked: (ids, locked) => {
      const chosen = new Set(ids);
      commit(locked ? "Lock" : "Unlock", (widgets) =>
        widgets.map((w) => (chosen.has(w.id) ? { ...w, locked } : w)),
      );
      if (locked) set((state) => ({ selection: state.selection.filter((id) => !chosen.has(id)) }));
    },

    setHidden: (ids, hidden) => {
      const chosen = new Set(ids);
      commit(hidden ? "Hide" : "Show", (widgets) =>
        widgets.map((w) => (chosen.has(w.id) ? { ...w, hidden } : w)),
      );
      if (hidden) set((state) => ({ selection: state.selection.filter((id) => !chosen.has(id)) }));
    },

    bringForward: (ids) => reorder(commit, get, targets(ids), "forward"),
    sendBackward: (ids) => reorder(commit, get, targets(ids), "backward"),
    bringToFront: (ids) => reorder(commit, get, targets(ids), "front"),
    sendToBack: (ids) => reorder(commit, get, targets(ids), "back"),

    group: () => {
      const { selection, canvas, doc } = get();
      if (selection.length < 2) return;

      const members = doc.widgets.filter((w) => selection.includes(w.id));
      const bounds = boundingRect(members.map((w) => widgetRect(w, canvas)));
      if (!bounds) return;

      const groupId = newId();
      const groupWidget = boardWidgetSchema.parse({
        id: groupId,
        type: GROUP_TYPE,
        ...rectToWidget(bounds, canvas),
        z: Math.max(...members.map((w) => w.z)),
      });

      const ids = new Set(selection);
      commit("Group", (widgets) => [
        ...widgets.map((w) => (ids.has(w.id) ? { ...w, groupId } : w)),
        groupWidget,
      ]);
    },

    ungroup: () => {
      const { selection, doc } = get();
      const groupIds = new Set(
        doc.widgets.filter((w) => selection.includes(w.id) && w.groupId).map((w) => w.groupId!),
      );
      if (groupIds.size === 0) return;

      commit("Ungroup", (widgets) =>
        widgets
          .filter((w) => !(w.type === GROUP_TYPE && groupIds.has(w.id)))
          .map((w) => (w.groupId && groupIds.has(w.groupId) ? { ...w, groupId: null } : w)),
      );
    },

    align: (edge) => {
      const { selection, canvas, doc } = get();
      if (selection.length < 2) return;

      const members = doc.widgets.filter((w) => selection.includes(w.id) && !w.locked);
      const aligned = alignRects(members.map((w) => widgetRect(w, canvas)), edge);
      const byId = new Map(members.map((w, index) => [w.id, aligned[index]]));

      commit("Align", (widgets) =>
        widgets.map((w) => {
          const rect = byId.get(w.id);
          return rect ? { ...w, ...rectToWidget(rect, canvas) } : w;
        }),
      );
    },

    distribute: (axis) => {
      const { selection, canvas, doc } = get();
      if (selection.length < 3) return;

      const members = doc.widgets.filter((w) => selection.includes(w.id) && !w.locked);
      const spread = distributeRects(members.map((w) => widgetRect(w, canvas)), axis);
      const byId = new Map(members.map((w, index) => [w.id, spread[index]]));

      commit("Distribute", (widgets) =>
        widgets.map((w) => {
          const rect = byId.get(w.id);
          return rect ? { ...w, ...rectToWidget(rect, canvas) } : w;
        }),
      );
    },

    copy: () => {
      const { selection, doc } = get();
      const ids = new Set(selection);
      clipboard = doc.widgets
        .filter((w) => ids.has(w.id) || (w.type === GROUP_TYPE && hasMemberIn(doc.widgets, w.id, ids)))
        .map((w) => ({ ...w }));
    },

    cut: () => {
      get().copy();
      get().remove();
    },

    paste: () => {
      if (clipboard.length === 0) return;
      const { canvas } = get();
      const copies = copyWidgets(clipboard, clipboard.map((w) => w.id), canvas, 16);

      commit("Paste", (widgets) => [...widgets, ...copies]);
      set({ selection: copies.filter((w) => w.type !== GROUP_TYPE).map((w) => w.id) });
    },

    undo: () => {
      const { history, doc } = get();
      const command = history.past[history.past.length - 1];
      if (!command) return;

      set({
        doc: applyPatch(doc, command.backward),
        history: {
          past: history.past.slice(0, -1),
          future: [command, ...history.future],
        },
      });
      get().pruneSelection();
    },

    redo: () => {
      const { history, doc } = get();
      const [command, ...rest] = history.future;
      if (!command) return;

      set({
        doc: applyPatch(doc, command.forward),
        history: { past: [...history.past, command], future: rest },
      });
      get().pruneSelection();
    },

    load: (input, canvas) => {
      set({
        doc: parseBoardDoc(input),
        loaded: true,
        history: emptyHistory(),
        selection: [],
        ...(canvas ? { canvas } : null),
      });
    },

    pruneSelection: () => {
      const { doc, selection } = get();
      const live = new Set(doc.widgets.map((w) => w.id));
      const next = selection.filter((id) => live.has(id));
      if (next.length !== selection.length) set({ selection: next });
    },

    refreshGroupBounds: () => {
      const { doc, canvas } = get();
      if (!doc.widgets.some((w) => w.type === GROUP_TYPE)) return;

      let changed = false;
      const widgets = doc.widgets.map((widget) => {
        if (widget.type !== GROUP_TYPE) return widget;
        const members = doc.widgets.filter((w) => w.groupId === widget.id);
        const bounds = boundingRect(members.map((w) => widgetRect(w, canvas)));
        if (!bounds) return widget;

        const next = { ...widget, ...rectToWidget(bounds, canvas) };
        if (next.x !== widget.x || next.y !== widget.y || next.w !== widget.w || next.h !== widget.h) {
          changed = true;
          return next;
        }
        return widget;
      });

      if (changed) set({ doc: { ...doc, widgets } });
    },
  };
});

// ---------------------------------------------------------------------------

/**
 * Selecting one member of a group selects the group.
 *
 * The group itself is never a transform target — it is a row in the document
 * carrying the membership and the box. What moves is its members, so that is
 * what the selection names.
 *
 * Exported because two things need it and having had two copies is how the
 * right-click menu ended up selecting differently from a left click.
 */
export function expandGroups(
  widgets: { id: string; groupId: string | null }[],
  ids: string[],
): string[] {
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const out = new Set<string>();

  for (const id of ids) {
    const widget = byId.get(id);
    if (!widget) continue;

    if (widget.groupId) {
      for (const sibling of widgets) {
        if (sibling.groupId === widget.groupId) out.add(sibling.id);
      }
    } else {
      out.add(id);
    }
  }

  return [...out];
}

function normaliseAngle(deg: number): number {
  const wrapped = deg % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped < -180 ? wrapped + 360 : wrapped;
}

function hasMemberIn(widgets: BoardWidget[], groupId: string, ids: Set<string>): boolean {
  return widgets.some((w) => w.groupId === groupId && ids.has(w.id));
}

/**
 * Copy widgets, keeping group membership intact.
 *
 * Ids are regenerated, and a copied group's members point at the copied group
 * rather than the original — otherwise a pasted pair would silently join the
 * group it was copied from.
 */
function copyWidgets(
  source: BoardWidget[],
  ids: string[],
  canvas: CanvasSize,
  offsetDesignUnits: number,
): BoardWidget[] {
  const chosen = new Set(ids);
  const wanted = source.filter(
    (w) => chosen.has(w.id) || (w.type === GROUP_TYPE && source.some((m) => m.groupId === w.id && chosen.has(m.id))),
  );
  if (wanted.length === 0) return [];

  const remap = new Map(wanted.map((w) => [w.id, newId()]));

  return wanted.map((widget) => {
    const rect = widgetRect(widget, canvas);
    return {
      ...widget,
      id: remap.get(widget.id)!,
      groupId: widget.groupId ? (remap.get(widget.groupId) ?? null) : null,
      ...rectToWidget(
        { ...rect, x: rect.x + offsetDesignUnits, y: rect.y + offsetDesignUnits },
        canvas,
      ),
    };
  });
}

/**
 * Z-order.
 *
 * `z` is re-sequenced from 0 after every move, so the numbers stay small and the
 * layers panel can rely on the order being total. Forward and backward step past
 * exactly one neighbour, which is what people expect from "bring forward" and is
 * not the same as adding one to z when two widgets share a value.
 */
function reorder(
  commit: (label: string, mutate: (widgets: BoardWidget[]) => BoardWidget[]) => void,
  get: () => EditorState,
  ids: string[],
  direction: "forward" | "backward" | "front" | "back",
) {
  if (ids.length === 0) return;
  const chosen = new Set(ids);
  const label = {
    forward: "Bring forward",
    backward: "Send backward",
    front: "Bring to front",
    back: "Send to back",
  }[direction];

  commit(label, (widgets) => {
    const stack = widgets
      .filter((w) => w.type !== GROUP_TYPE)
      .slice()
      .sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));

    const order = stack.map((w) => w.id);
    const moved = moveWithin(order, chosen, direction);

    const rank = new Map(moved.map((id, index) => [id, index]));
    return widgets.map((w) => {
      const z = rank.get(w.id);
      return z === undefined || z === w.z ? w : { ...w, z };
    });
  });
}

function moveWithin(
  order: string[],
  chosen: Set<string>,
  direction: "forward" | "backward" | "front" | "back",
): string[] {
  const selected = order.filter((id) => chosen.has(id));
  const rest = order.filter((id) => !chosen.has(id));

  if (direction === "front") return [...rest, ...selected];
  if (direction === "back") return [...selected, ...rest];

  const next = order.slice();
  const indices = next
    .map((id, index) => ({ id, index }))
    .filter(({ id }) => chosen.has(id))
    .map(({ index }) => index);

  // Walk from the end when moving up and from the start when moving down, so a
  // multi-selection keeps its internal order and does not pile onto one slot.
  const walk = direction === "forward" ? indices.slice().reverse() : indices;

  for (const index of walk) {
    const swapWith = direction === "forward" ? index + 1 : index - 1;
    if (swapWith < 0 || swapWith >= next.length) continue;
    if (chosen.has(next[swapWith])) continue;
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
  }

  return next;
}
