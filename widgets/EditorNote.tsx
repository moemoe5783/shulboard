import type { ReactNode } from "react";

/*
 * A warning pinned to an element on the editor's canvas — "2 zmanim don't fit"
 * — and never on a screen. It is the renderer's own chrome (design.md §1b), so
 * tokens, not board colours, and the stale status colour because it is a
 * status: something on the board won't all show.
 *
 * `data-editor-hint` hides it everywhere but inside the editor's canvas
 * (app/globals.css): the same DOM in both places, the difference in the
 * editor's wrapper — CLAUDE.md's no-fork rule — rather than a Renderer prop.
 * Sized against the board (cqw) with a floor, so it reads at any zoom.
 */
export function EditorWarning({ children }: { children: ReactNode }) {
  return (
    <div
      data-editor-hint
      data-editor-warning
      role="status"
      className="bg-stale text-surface font-ui pointer-events-none absolute inset-x-0 bottom-0 z-10 px-[0.6em] py-[0.3em] text-center leading-tight"
      style={{ fontSize: "max(11px, 0.9cqw)", fontWeight: 600 }}
    >
      {children}
    </div>
  );
}
