"use client";

import { useEffect, useRef } from "react";
import { useCommands } from "./commands";

/*
 * The right-click menu — §4b, "mirroring the above".
 *
 * It reads the same command list the toolbar does, so it cannot fall behind.
 * A menu genuinely floats, which is what earns it the one shadow in the product.
 */

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
      if (ref.current?.contains(event.target as Node)) return;
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

  if (!at) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className="rounded-panel border-rule bg-surface font-ui fixed z-50 w-56 border p-1 shadow-menu"
      style={{ left: at.x, top: at.y }}
    >
      {groups.map((group, index) => (
        <div key={group.id} className={index > 0 ? "border-rule mt-1 border-t pt-1" : undefined}>
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
  );
}
