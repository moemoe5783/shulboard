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
  /** Effective provider — screen-then-org, same tier as latitude/longitude
   *  (plan.md §5c: "provider is a screen-level setting, with per-widget
   *  override"). A widget's own override (candle-lighting's own
   *  `provider: "inherit" | "hebcal" | "chabad" | "manual"`) resolves
   *  "inherit" against this value — this context is the only place that
   *  knows it. */
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
 * What every board that predates this feature — a demo page, editor-lab,
 * font-parity, an org that has never touched the zmanim setting — resolves
 * to. Matches the schema's own `zmanim_provider` default (`'hebcal'`)
 * exactly, so a board with no opinion about any of this behaves exactly as
 * it did before this context existed.
 */
export const DEFAULT_BOARD_ZMANIM: BoardZmanim = {
  provider: "hebcal",
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
 *  effective zmanim provider (the schema defaults it to "hebcal"), so
 *  there's no "not configured" case for this hook the way there is for
 *  location; DEFAULT_BOARD_ZMANIM above is exactly that always-valid
 *  default, not a placeholder to guard against. */
export function useBoardZmanim(): BoardZmanim {
  return useContext(BoardZmanimContext);
}
