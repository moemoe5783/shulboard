"use client";

import { useSyncExternalStore } from "react";
import { CHROME_BUTTON } from "@/app/(dev)/editor-lab/chrome";
import { NumberField } from "@/components/editor/NumberField";
import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import { SliderField } from "@/components/editor/SliderField";
import type { WidgetSettingsProps } from "@/widgets/types";
import { AlbumField } from "../media/AlbumField";
import { readCollageConfig, type CollageConfig } from "./manifest";

const DEFAULT_LEFTOVER = "#1b2a2e";

/** The collage element on the canvas for this widget — where the preview
 *  controls send their events and read the cycle's state back from. */
function collageElement(widgetId: string | undefined): HTMLElement | null {
  if (!widgetId || typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-widget-id="${widgetId}"] [data-collage]`);
}

type Status = { page: string; cycle: string; count: string; playing: boolean } | null;

function subscribe(widgetId: string | undefined, onChange: () => void): () => void {
  const widget = widgetId ? document.querySelector(`[data-widget-id="${widgetId}"]`) : null;
  if (!widget) return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(widget, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-collage-page", "data-collage-playing", "data-collage-count", "data-collage-cycle"],
  });
  return () => observer.disconnect();
}

let lastStatus: Status = null;
function readStatus(widgetId: string | undefined): Status {
  const el = collageElement(widgetId);
  const next: Status = el?.dataset.collagePage
    ? {
        page: el.dataset.collagePage,
        cycle: el.dataset.collageCycle ?? "1",
        count: el.dataset.collageCount ?? "0",
        playing: el.dataset.collagePlaying !== "false",
      }
    : null;
  // useSyncExternalStore needs a stable snapshot for an unchanged state.
  if (
    lastStatus &&
    next &&
    lastStatus.page === next.page &&
    lastStatus.cycle === next.cycle &&
    lastStatus.count === next.count &&
    lastStatus.playing === next.playing
  ) {
    return lastStatus;
  }
  lastStatus = next;
  return next;
}

export function Settings({ config: raw, onChange, widgetIds }: WidgetSettingsProps<CollageConfig>) {
  const config = readCollageConfig(raw);
  const widgetId = widgetIds?.length === 1 ? widgetIds[0] : undefined;
  const status = useSyncExternalStore(
    (onStoreChange) => subscribe(widgetId, onStoreChange),
    () => readStatus(widgetId),
    () => null,
  );
  const send = (event: "collage:next" | "collage:toggle") => collageElement(widgetId)?.dispatchEvent(new Event(event));

  return (
    <div className="flex flex-col gap-4">
      <AlbumField value={config.albumId} onChange={(albumId) => onChange({ albumId })} />

      {widgetId && status && (
        <div className="flex flex-col gap-2">
          <span className={PANEL_LABEL}>
            Page {status.page}, cycle {status.cycle} — {status.count} {status.count === "1" ? "photo" : "photos"}
          </span>
          <div className="flex gap-2">
            <button type="button" className={`${CHROME_BUTTON} border-paper/20 flex-1 border`} onClick={() => send("collage:next")}>
              Next page
            </button>
            <button type="button" className={`${CHROME_BUTTON} border-paper/20 flex-1 border`} onClick={() => send("collage:toggle")}>
              {status.playing ? "Pause" : "Play"}
            </button>
          </div>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Photos per page</span>
        <select
          value={config.density}
          onChange={(event) => onChange({ density: event.target.value as CollageConfig["density"] })}
          className={PANEL_CONTROL}
        >
          <option value="auto">Automatic — as many as stay readable</option>
          <option value="few">Few (2–4)</option>
          <option value="medium">Medium (4–8)</option>
          <option value="many">Many (8–14)</option>
          <option value="exact">Exactly…</option>
        </select>
      </label>
      {config.density === "exact" && (
        <NumberField
          label="Photos on each page"
          value={config.exactCount}
          onChange={(exactCount) => onChange({ exactCount })}
          min={1}
          max={14}
        />
      )}

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Order</span>
        <select
          value={config.order}
          onChange={(event) => onChange({ order: event.target.value as CollageConfig["order"] })}
          className={PANEL_CONTROL}
        >
          <option value="newest">Newest first</option>
          <option value="album">Album order</option>
          <option value="shuffle">Shuffle</option>
        </select>
      </label>

      <NumberField
        label="Seconds per page"
        value={config.intervalSeconds}
        onChange={(intervalSeconds) => onChange({ intervalSeconds })}
        min={3}
        max={120}
      />

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Transition</span>
        <select
          value={config.transition}
          onChange={(event) => onChange({ transition: event.target.value as CollageConfig["transition"] })}
          className={PANEL_CONTROL}
        >
          <option value="crossfade">Crossfade</option>
          <option value="fade">Fade through the background</option>
          <option value="none">None</option>
        </select>
      </label>

      <SliderField label="Gap" value={config.gutter} min={0} max={60} onChange={(gutter) => onChange({ gutter })} />
      <SliderField
        label="Photo corner radius"
        value={config.photoRadius}
        min={0}
        max={80}
        onChange={(photoRadius) => onChange({ photoRadius })}
      />

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Photo edge</span>
        <select
          value={config.photoFrame}
          onChange={(event) => onChange({ photoFrame: event.target.value as CollageConfig["photoFrame"] })}
          className={PANEL_CONTROL}
        >
          <option value="none">None</option>
          <option value="border">Thin border</option>
          <option value="shadow">Soft shadow</option>
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.leftoverColor !== ""}
            onChange={(event) => onChange({ leftoverColor: event.target.checked ? DEFAULT_LEFTOVER : "" })}
            className={PANEL_CHECKBOX}
          />
          <span className="text-cell text-paper">Colour behind the photos</span>
        </label>
        {config.leftoverColor !== "" && (
          <label className="flex items-center gap-2 pl-6">
            <input
              type="color"
              value={config.leftoverColor}
              onChange={(event) => onChange({ leftoverColor: event.target.value })}
              className="border-paper/20 h-8 w-12 rounded-[5px] border bg-transparent"
              aria-label="Colour behind the photos"
            />
            <span className={PANEL_LABEL}>Fills any space the photos don’t</span>
          </label>
        )}
      </div>
    </div>
  );
}
