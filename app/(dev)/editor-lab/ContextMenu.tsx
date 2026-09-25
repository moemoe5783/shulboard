"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { WIDGET_GROUPS, addWidget } from "./AddWidgetMenu";
import { useCommands } from "./commands";

/*
 * The right-click menu — §4b, "mirroring the above".
 *
 * It reads the same command list the toolbar does, so it cannot fall behind.
 * A menu genuinely floats, which is what earns it the one shadow in the product.
 *
 * Opened on empty board with nothing selected, it leads with "Add element",
 * whose list opens beside it and drops the new element where the click was.
 */

/** Where on the board a point in the window is, in design units — or nothing
 *  if it's off the board, and an added element goes in the middle. */
function boardPointAt(at: MenuPosition) {
  const rect = document.querySelector<HTMLElement>("[data-editor-surface]")?.getBoundingClientRect();
  const { zoom } = useEditor.getState();
  if (!rect || zoom <= 0) return undefined;
  if (at.x < rect.left || at.x > rect.right || at.y < rect.top || at.y > rect.bottom) return undefined;
  return { x: (at.x - rect.left) / zoom, y: (at.y - rect.top) / zoom };
}

export type MenuPosition = { x: number; y: number };

export function ContextMenu({
  at,
  onClose,
}: {
  at: MenuPosition | null;
  onClose: () => void;
}) {
  const groups = useCommands();
  const ref = useRef<HTMLDivElement>(null);
  const addRowRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const nothingSelected = useEditor((s) => s.selection.length === 0);

  /** The add list, open for this opening of the menu only. */
  const [addOpenAt, setAddOpenAt] = useState<MenuPosition | null>(null);
  const addOpen = addOpenAt !== null && addOpenAt === at;
  const setAddOpen = (open: boolean) => setAddOpenAt(open ? at : null);

  /** The add list opens beside its row, on whichever side has room. */
  const [flyout, setFlyout] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const row = addRowRef.current;
    const list = flyoutRef.current;
    if (!addOpen || !row || !list) {
      setFlyout(null);
      return;
    }
    const margin = 8;
    const menu = ref.current?.getBoundingClientRect() ?? row.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    const width = list.getBoundingClientRect().width;
    const maxHeight = window.innerHeight - margin * 2;
    const height = Math.min(list.scrollHeight + 2, maxHeight);
    const left =
      menu.right + width + margin <= window.innerWidth ? menu.right + 2 : Math.max(margin, menu.left - width - 2);
    const top = Math.max(margin, Math.min(box.top - 4, window.innerHeight - height - margin));
    setFlyout({ left, top, maxHeight });
  }, [addOpen]);

  /*
   * Dismiss on a press outside — and only outside.
   *
   * THE BUG THIS FIXES. The listener was on document in the capture phase with
   * no containment check, and the menu relied on an onPointerDown handler on
   * itself to stop it. That cannot work: capture runs document-first, so the
   * menu was already unmounted by the time React would have seen the press, the
   * button was gone before the click completed, and every command in the menu
   * did nothing at all. It looked like a menu and behaved like a picture of one.
   *
   * Capture is still right — a press elsewhere should put the menu away before
   * that press does anything else — but it has to ask where the press landed.
   */
  useEffect(() => {
    if (!at) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || flyoutRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [at, onClose]);

  /*
   * Kept inside the window. Opened near the bottom or the right edge, the menu
   * flips to open upward or leftward from the pointer; in a window shorter
   * than the whole menu it pins to the top and scrolls. Measured before paint,
   * so it never shows cut off first.
   */
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight?: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!at || !el) {
      setPlace(null);
      return;
    }
    const margin = 8;
    const { width } = el.getBoundingClientRect();
    // The full height, even if a previous opening capped it.
    const height = el.scrollHeight + 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = at.x + width + margin > vw ? at.x - width : at.x;
    left = Math.max(margin, Math.min(left, vw - width - margin));
    let top = at.y + height + margin > vh ? at.y - height : at.y;
    const maxHeight = height > vh - margin * 2 ? vh - margin * 2 : undefined;
    top = maxHeight ? margin : Math.max(margin, Math.min(top, vh - height - margin));
    setPlace({ left, top, maxHeight });
  }, [at]);

  if (!at) return null;

  return (
    <>
    <div
      ref={ref}
      role="menu"
      className="rounded-panel border-rule bg-surface font-ui fixed z-50 w-56 overflow-y-auto border p-1 shadow-menu"
      style={
        place
          ? { left: place.left, top: place.top, maxHeight: place.maxHeight }
          : // First layout pass, off screen, to measure.
            { left: at.x, top: at.y, visibility: "hidden" }
      }
    >
      {nothingSelected && (
        <div className="border-rule mb-1 border-b pb-1">
          <button
            ref={addRowRef}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={addOpen}
            data-context-add
            onClick={() => setAddOpen(!addOpen)}
            onPointerEnter={() => setAddOpen(true)}
            className={`text-cell rounded-control text-ink hover:bg-verdigris-wash/40 flex h-8 w-full items-center gap-4 px-2 text-left ${
              addOpen ? "bg-verdigris-wash/40" : ""
            }`}
          >
            <span className="min-w-0 flex-1 truncate">Add element</span>
            <span aria-hidden className="text-meta text-ink-faint shrink-0">
              &rsaquo;
            </span>
          </button>
        </div>
      )}
      {groups.map((group, index) => (
        <div
          key={group.id}
          className={index > 0 ? "border-rule mt-1 border-t pt-1" : undefined}
          onPointerEnter={() => setAddOpen(false)}
        >
          {group.commands.map((command) => (
            <button
              key={command.id}
              type="button"
              role="menuitem"
              disabled={!command.enabled}
              onClick={() => {
                command.run();
                onClose();
              }}
              className="text-cell rounded-control text-ink enabled:hover:bg-verdigris-wash/40 disabled:text-ink-faint flex h-8 w-full items-center gap-4 px-2 text-left disabled:cursor-not-allowed"
            >
              <span className="min-w-0 flex-1 truncate">{command.label}</span>
              {command.shortcut && (
                <span className="text-meta text-ink-faint numeric shrink-0">{command.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
    {nothingSelected && addOpen && (
      <div
        ref={flyoutRef}
        role="menu"
        aria-label="Add element"
        data-context-add-menu
        className="rounded-panel border-rule bg-surface font-ui fixed z-50 w-56 overflow-y-auto overscroll-contain border p-1 shadow-menu"
        style={flyout ?? { left: 0, top: 0, visibility: "hidden" }}
      >
        {WIDGET_GROUPS.map((group, index) => (
          <div key={group.category} className={index > 0 ? "border-rule mt-1 border-t pt-1" : undefined}>
            <p className="text-meta text-ink-soft px-2 py-1">{group.name}</p>
            {group.widgets.map((manifest) => (
              <button
                key={manifest.id}
                type="button"
                role="menuitem"
                data-context-add-widget={manifest.id}
                onClick={() => {
                  addWidget(manifest.id, boardPointAt(at));
                  onClose();
                }}
                className="text-cell rounded-control text-ink hover:bg-verdigris-wash/40 flex h-8 w-full items-center px-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate">{manifest.name}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    )}
    </>
  );
}
