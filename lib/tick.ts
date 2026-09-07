"use client";

import { useSyncExternalStore } from "react";

/*
 * The master second-tick — docs/plan.md §3e.
 *
 * "No setInterval accumulation: one master rAF/second-tick that all time widgets
 * subscribe to."
 *
 * There is exactly one timer in this module, whatever a board contains. Twelve
 * clocks, a countdown and three zmanim widgets share it, and it stops entirely
 * when the last of them unmounts. The failure this prevents is specific and
 * real: a display route runs for months, a board rotates every thirty seconds,
 * and a per-widget interval that survives its widget leaks one timer per
 * rotation until the TV WebView dies at 3am and a gabbai calls about a black
 * screen in the lobby.
 *
 * A TIMEOUT ALIGNED TO THE NEXT SECOND, NOT requestAnimationFrame. §3e names
 * either. A rAF loop would run sixty times a second forever to notice a change
 * that happens once, which on a TV box left on for a month is real CPU spent on
 * nothing. This wakes once per second, and because each wake recomputes the
 * delay from the wall clock it stays on the second boundary rather than drifting
 * — so the display flips at the same moment the wall clock does, and it
 * self-corrects after a device sleeps, a clock sync, or a DST change.
 */

/** Epoch SECONDS, not a Date. useSyncExternalStore compares snapshots by
 *  identity, and a fresh Date every read would re-render forever. */
let currentSecond = Math.floor(Date.now() / 1000);

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleNextTick() {
  const now = Date.now();
  // Land just after the boundary rather than on it: a timer that fires a
  // millisecond early would read the second it just left and show a time one
  // behind for a whole second.
  const delay = 1000 - (now % 1000) + 5;

  timer = setTimeout(() => {
    currentSecond = Math.floor(Date.now() / 1000);
    for (const listener of listeners) listener();
    if (listeners.size > 0) scheduleNextTick();
    else timer = null;
  }, delay);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (timer === null) {
    currentSecond = Math.floor(Date.now() / 1000);
    scheduleNextTick();
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => currentSecond;

/**
 * The server has no clock worth agreeing with.
 *
 * Whatever second the server rendered would be a different second by the time
 * the markup reached a TV, so it returns null and every time widget renders a
 * placeholder until the browser takes over. Rendering the server's time instead
 * would be a hydration mismatch on every single load.
 */
const getServerSnapshot = () => null;

/**
 * The current second, or null before the browser has one.
 *
 * Every time widget calls this and nothing else. A widget that reaches for
 * setInterval, Date.now() in a render, or its own rAF is the bug §3e is about.
 */
export function useSecond(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** How many subscribers the tick has. For tests and for the lab's status bar —
 *  a number that climbs while widgets come and go is the leak, visible. */
export function tickListenerCount(): number {
  return listeners.size;
}
