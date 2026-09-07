"use client";

import { useSyncExternalStore } from "react";

/*
 * Whether a widget's content currently overflows its box — docs/sizing.md §3's
 * editor warning: "the gabbai should learn this in the editor, not from a
 * screen in the lobby."
 *
 * Reads the `data-overflowing` attribute BoardRenderer's WidgetFrame sets on
 * its own node (components/board/BoardRenderer.tsx) — the same node already
 * found by `data-widget-id` for selection and dragging (TransformFrame.tsx).
 *
 * useSyncExternalStore, not a MutationObserver wired to useState: the value
 * being watched lives entirely outside React (a DOM attribute another
 * component's effect writes), which is exactly the case this hook exists for
 * — subscribing without a setState call in an effect body to trigger it.
 */
function subscribe(widgetId: string | null, onChange: () => void): () => void {
  if (!widgetId) return () => {};
  const el = document.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"]`);
  if (!el) return () => {};

  const observer = new MutationObserver(onChange);
  observer.observe(el, { attributes: true, attributeFilter: ["data-overflowing"] });
  return () => observer.disconnect();
}

function readOverflow(widgetId: string | null): boolean {
  if (!widgetId) return false;
  const el = document.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"]`);
  return el?.dataset.overflowing === "true";
}

export function useElementOverflow(widgetId: string | null): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(widgetId, onChange),
    () => readOverflow(widgetId),
    () => false,
  );
}
