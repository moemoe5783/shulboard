import type { ReactNode } from "react";

/*
 * A note pinned to an element on the editor's canvas — "Showing 11 zmanim in
 * 3 pages" — and never on a screen. Information, not a fault: the board is
 * doing what it was set to. It is the renderer's own chrome (design.md §1b),
 * so tokens, not board colours, and quiet ones — ink on paper, no status
 * colour.
 *
 * `data-editor-hint` hides it everywhere but inside the editor's canvas
 * (app/globals.css): the same DOM in both places, the difference in the
 * editor's wrapper — CLAUDE.md's no-fork rule — rather than a Renderer prop.
 * Sized against the board (cqw) with a floor, so it reads at any zoom.
 */
export function EditorNote({ children }: { children: ReactNode }) {
  return (
    <div
      data-editor-hint
      data-editor-note
      className="bg-ink/85 text-paper font-ui pointer-events-none absolute inset-x-0 bottom-0 z-10 px-[0.6em] py-[0.3em] text-center leading-tight"
      style={{ fontSize: "max(11px, 0.9cqw)" }}
    >
      {children}
    </div>
  );
}
