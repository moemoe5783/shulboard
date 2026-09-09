import type { ChabadZman } from "./chabad-adapter";

/*
 * Reading a cached Chabad zmanim dict the same way lib/hebrew/candle-times.ts
 * reads @hebcal/core — client-safe, no fetch, no server-only import (only
 * the type from chabad-adapter.ts, erased at compile time).
 *
 * candle-lighting/Renderer.tsx is the only caller today: the widget already
 * has "now" and the board's resolved zmanim dict (lib/board-location.tsx)
 * and needs exactly what lib/hebrew/candle-times.ts's upcomingCandleLighting
 * gives the Hebcal path — the next one, after now, or null.
 */

export type ChabadZmanimByDate = Record<string, Record<string, ChabadZman>>;

/**
 * The next `candle_lighting` value strictly after `now`, across every date
 * in `byDate` — mirrors upcomingCandleLighting's "advances past an event
 * once it's passed" contract (scripts/test-hebrew.ts) even though this
 * reads a cache dict rather than computing anything. `byDate` is expected
 * to already be bounded to a search window (the same handful of days
 * upcomingCandleLighting's own SEARCH_WINDOW_DAYS covers) by whoever built
 * it — this function does not know or care how many dates it was handed.
 */
export function nextChabadCandleLighting(now: Date, byDate: ChabadZmanimByDate): ChabadZman | null {
  const upcoming = Object.values(byDate)
    .map((zmanim) => zmanim.candle_lighting)
    .filter((zman): zman is ChabadZman => Boolean(zman) && new Date(zman.iso).getTime() > now.getTime())
    .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());

  return upcoming[0] ?? null;
}
