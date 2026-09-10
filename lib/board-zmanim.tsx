"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ChabadZmanimByDate } from "@/lib/zmanim/resolve";

/*
 * The board's zmanim provider configuration — a sibling to
 * lib/board-location.tsx, deliberately NOT folded into it.
 *
 * BoardLocation is the type every lib/hebrew/* astronomical function takes
 * (sunset, parsha, candle-times) — plain geography, nothing about which paid
 * zmanim service a shul picked. Adding provider fields there would put
 * "which zmanim API a shul chose" into the same type sunsetOn() uses to
 * find a latitude, and would force every call site across the whole Hebrew
 * computation layer — including every hand-verified fixed-date check in
 * scripts/test-hebrew.ts — to carry fields it has no use for. This is its
 * own context for the same reason lib/board-location.tsx's own header
 * comment gives for existing at all: genuinely ambient, board-level state
 * no widget owns, read with a hook instead of threaded through the
 * `{config, canvas}` renderer contract (CLAUDE.md).
 */
export type BoardZmanim = {
  /**
   * Effective provider — screen-then-org, same tier as latitude/longitude
   * (plan.md §5c), resolved through `effectiveZmanimProvider`.
   *
   * UNREAD BY EVERY WIDGET TODAY, and kept rather than deleted. Chabad.org
   * is the only source (lib/zmanim/provider.ts), so there is nothing for a
   * widget to branch on and none of them do; what they read is
   * `hasChabadLocation` below. The field stays because it is what the
   * bundle already carries end to end (lib/bundle/types.ts's
   * `zmanimProvider`), and because the day a second provider returns this
   * is the value every widget needs — deleting it now would mean threading
   * it back through the bundle, the editor preview and their tests to get
   * it again.
   */
  provider: "hebcal" | "chabad" | "myzmanim" | "manual";
  /**
   * Whether Chabad has a resolvable location on file — a US ZIP or a
   * manually-entered raw id (lib/zmanim/location.ts). Only meaningful when
   * `provider` is `"chabad"`. A widget needs only this boolean, never the
   * raw id, to tell "no time yet" (an ordinary gap, same as any other
   * provider) apart from "set your ZIP or Chabad location" (this
   * provider's own extra requirement) — see
   * widgets/hebrew/EmptyLocation.tsx and candle-lighting/Renderer.tsx.
   */
  hasChabadLocation: boolean;
  /**
   * Cached Chabad zmanim actually available to render, keyed by date — the
   * bundle's own `content.zmanim` on the display route, a short live
   * `zmanim_cache` read in the editor (boards/[id]/page.tsx). `null` when
   * the provider isn't Chabad, or when it is but nothing has warmed the
   * cache yet — a widget treats that the same as "no time yet," not as a
   * configuration error.
   */
  chabadZmanim: ChabadZmanimByDate | null;
};

/**
 * What every board with no zmanim context resolves to — a demo page,
 * editor-lab, font-parity, a `BoardRenderer` called without the prop.
 *
 * `"chabad"` rather than the schema's `'hebcal'` default, because
 * `effectiveZmanimProvider` resolves every stored value to Chabad and this
 * default has to agree with it (lib/zmanim/provider.ts). The visible
 * consequence, stated rather than discovered: a page with no zmanim
 * context shows the "hasn't set a ZIP or Chabad.org location yet" empty
 * state on a zmanim or candle-lighting widget, where it used to show a
 * Hebcal-computed time. That is the honest answer now — there is no Hebcal
 * zmanim path left to compute one — and it is the same state a real shul
 * with no ZIP on file sees, which makes those pages a truer preview than
 * they were.
 */
export const DEFAULT_BOARD_ZMANIM: BoardZmanim = {
  provider: "chabad",
  hasChabadLocation: false,
  chabadZmanim: null,
};

const BoardZmanimContext = createContext<BoardZmanim>(DEFAULT_BOARD_ZMANIM);

export function BoardZmanimProvider({
  zmanim,
  children,
}: {
  zmanim: BoardZmanim | null | undefined;
  children: ReactNode;
}) {
  return <BoardZmanimContext.Provider value={zmanim ?? DEFAULT_BOARD_ZMANIM}>{children}</BoardZmanimContext.Provider>;
}

/** Never null, unlike useBoardLocation() — a board always has *some*
 *  effective zmanim provider, so there's no "not configured" case for this
 *  hook the way there is for location; DEFAULT_BOARD_ZMANIM above is
 *  exactly that always-valid default, not a placeholder to guard
 *  against. */
export function useBoardZmanim(): BoardZmanim {
  return useContext(BoardZmanimContext);
}
