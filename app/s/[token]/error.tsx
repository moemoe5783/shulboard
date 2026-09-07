"use client";

import { useEffect } from "react";

/*
 * The display's error boundary — docs/plan.md §3e: "log + reload rather than
 * white screen."
 *
 * A television has nobody to press a button. The one recovery available is a
 * reload, and it is usually enough: the bundle is in IndexedDB, the shell is in
 * the service worker's cache, and the thing that threw was a render.
 *
 * GUARDED AGAINST A LOOP, which is the failure this obviously-correct idea
 * produces. A board that throws on every render would otherwise reload forever,
 * hammering the origin and never showing anything. The count is in
 * sessionStorage so it survives the reload and dies with the tab; after three
 * attempts the screen stops and says so, which is a legible failure instead of a
 * flickering one.
 */

const ATTEMPTS_KEY = "shulboard.display.reloads";
const MAX_ATTEMPTS = 3;
const RELOAD_DELAY_MS = 5000;

function attempts(): number {
  try {
    return Number(sessionStorage.getItem(ATTEMPTS_KEY) ?? "0");
  } catch {
    return 0;
  }
}

export default function DisplayError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    const soFar = attempts();
    if (soFar >= MAX_ATTEMPTS) return;

    try {
      sessionStorage.setItem(ATTEMPTS_KEY, String(soFar + 1));
    } catch {
      // Without a counter the guard cannot hold, so do not reload at all —
      // an unbounded loop is worse than a stopped screen.
      return;
    }

    const timer = setTimeout(() => location.reload(), RELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="bg-ink text-paper font-ui flex h-screen w-screen items-center justify-center">
      <p className="text-body opacity-60">
        {attempts() >= MAX_ATTEMPTS
          ? "This screen can't start. Check the dashboard."
          : "Restarting this screen."}
        {error.digest ? ` Reference ${error.digest}.` : ""}
      </p>
    </div>
  );
}
