"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavRail, type NavRailProps } from "./NavRail";

/*
 * The signed-in shell: the rail beside the content on a desk (the `desk`
 * variant, app/globals.css — wide and tall enough), and on a phone, upright or
 * sideways, a top bar with the shul's name and a Menu button that opens the
 * same rail as a panel over the page. One rail component in both, so a phone never has
 * a different map of the product.
 *
 * The panel floats over the page, which is what earns it a shadow (design.md
 * §3). It closes on a link, on the backdrop, and on Escape.
 */
export function AppShell({ rail, children }: { rail: NavRailProps; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const shulName = rail.orgs.find((org) => org.id === rail.activeOrgId)?.name ?? "Shulboard";

  useEffect(() => {
    if (!open) return;
    const button = menuButton.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // The page underneath doesn't scroll while the menu is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      button?.focus();
    };
  }, [open]);

  return (
    <div className="bg-paper font-ui desk:flex-row flex min-h-screen flex-col">
      <header className="border-rule bg-paper desk:hidden sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b px-4">
        <span className="text-body min-w-0 truncate font-semibold">{shulName}</span>
        <button
          ref={menuButton}
          type="button"
          aria-expanded={open}
          aria-controls="app-menu"
          onClick={() => setOpen(true)}
          className="text-cell rounded-control border-rule-firm hover:bg-verdigris-wash/40 h-8 shrink-0 border px-3"
        >
          Menu
        </button>
      </header>

      {/* Stays put while the page scrolls: pinned to the top of the window,
          as tall as it, scrolling itself only if the window is shorter than
          the rail. */}
      <NavRail {...rail} className="desk:flex desk:sticky desk:top-0 desk:h-screen desk:overflow-y-auto hidden w-54 shrink-0" />

      {open && (
        <div className="desk:hidden fixed inset-0 z-40">
          <div aria-hidden className="bg-ink/40 absolute inset-0" onClick={() => setOpen(false)} />
          <div
            id="app-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="bg-paper shadow-menu absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto"
            // Any link in the menu navigates, so the menu's job is done.
            onClickCapture={(event) => {
              if ((event.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            <div className="flex justify-end px-3 pt-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-cell rounded-control hover:bg-verdigris-wash/40 h-8 px-3"
              >
                Close
              </button>
            </div>
            <NavRail {...rail} className="flex min-h-0 flex-1" />
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1 px-4 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-360">{children}</div>
      </div>
    </div>
  );
}
