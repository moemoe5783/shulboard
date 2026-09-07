"use client";

import { useEffect } from "react";
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

  useEffect(() => {
    if (!at) return;
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Capture, so a press anywhere puts the menu away before that press does
    // anything else.
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [at, onClose]);

  if (!at) return null;

  return (
    <div
      role="menu"
      className="rounded-panel border-rule bg-surface font-ui fixed z-50 w-56 border p-1 shadow-menu"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(event) => event.stopPropagation()}
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
