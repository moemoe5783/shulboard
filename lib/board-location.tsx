"use client";

import { createContext, useContext, type ReactNode } from "react";

/*
 * Where a board is being shown — plan.md §3b: "Clock, date, Hebrew date,
 * parsha, daf yomi, candle lighting... computed in the browser from lat/long +
 * system clock." Candle lighting and a sunset-rollover Hebrew date both need
 * real coordinates; nothing about them can be computed from the screen's
 * timezone alone.
 *
 * A CONTEXT, NOT A WIDGET PROP. widgets/types.ts's WidgetRendererProps is
 * `{config, canvas}` and nothing else — CLAUDE.md is explicit that adding a
 * third thing there is the editor/display fork arriving in disguise. Location
 * is genuinely ambient, the same way the tick in lib/tick.ts is: every widget
 * on a board shares the same one, no widget owns it, and it comes from
 * whichever screen (or, in the editor, org) the board is currently being
 * looked at through — never from the widget's own config. A widget reads it
 * with useBoardLocation() instead, which costs the renderer contract nothing.
 *
 * BoardRenderer.tsx is what actually provides it, from a `location` prop of
 * its own — that prop is fine precisely because BoardRenderer is not the
 * widget Renderer CLAUDE.md's rule is about; it is the shared wrapper that
 * already carries `canvas` and `widgetProps` the same way.
 */
export type BoardLocation = {
  latitude: number;
  longitude: number;
  /** Olson tzid, e.g. "America/New_York" — sunset and candle lighting both
   *  have to be computed in the location's own zone, never the viewing
   *  device's, or an editor open in a different city renders the wrong
   *  moment. */
  timeZone: string;
};

const BoardLocationContext = createContext<BoardLocation | null>(null);

export function BoardLocationProvider({
  location,
  children,
}: {
  location: BoardLocation | null;
  children: ReactNode;
}) {
  return <BoardLocationContext.Provider value={location}>{children}</BoardLocationContext.Provider>;
}

/**
 * `null` means genuinely unknown — no org/screen coordinates configured, not
 * "still loading". Every widget that needs this must have its own honest
 * empty state for that case (design.md §5: "empty states are instructions,
 * not moods") rather than guessing at a default location.
 */
export function useBoardLocation(): BoardLocation | null {
  return useContext(BoardLocationContext);
}
