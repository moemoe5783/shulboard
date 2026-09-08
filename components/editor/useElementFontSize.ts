"use client";

import { useSyncExternalStore } from "react";

/*
 * A `fit`-mode widget's live, computed type size, in board design units —
 * docs/sizing.md's properties-panel requirement: "an objective, visible type
 * size for every text element... in fit mode it's the computed result and
 * read-only."
 *
 * Reads the `data-fitted-size` attribute widgets/useFitFontSize.ts writes onto
 * its own `box` element — a descendant of the node already found by
 * `data-widget-id` for selection and dragging (TransformFrame.tsx). Same
 * useSyncExternalStore-over-a-DOM-attribute shape as useElementOverflow.ts,
 * for the same reason: the value lives entirely outside React.
 */
function subscribe(widgetId: string | null, onChange: () => void): () => void {
  if (!widgetId) return () => {};
  const el = document.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"] [data-fitted-size]`);
  if (!el) return () => {};

  const observer = new MutationObserver(onChange);
  observer.observe(el, { attributes: true, attributeFilter: ["data-fitted-size"] });
  return () => observer.disconnect();
}

function readFontSize(widgetId: string | null): number | null {
  if (!widgetId) return null;
  const el = document.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"] [data-fitted-size]`);
  const raw = el?.dataset.fittedSize;
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : null;
}

export function useElementFontSize(widgetId: string | null): number | null {
  return useSyncExternalStore(
    (onChange) => subscribe(widgetId, onChange),
    () => readFontSize(widgetId),
    () => null,
  );
}
