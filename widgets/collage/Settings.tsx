"use client";

import { useSyncExternalStore } from "react";
import { CHROME_BUTTON, CHROME_BUTTON_ON } from "@/app/(dev)/editor-lab/chrome";
import { ColorField } from "@/components/editor/ColorField";
import { NumberField } from "@/components/editor/NumberField";
import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import { FRAME_LABELS, FRAME_STYLES } from "@/lib/collage/artsy/frames";
import { SliderField } from "@/components/editor/SliderField";
import type { WidgetSettingsProps } from "@/widgets/types";
import { AlbumsField } from "../media/AlbumField";
import { ARTSY_BACKDROPS, readCollageConfig, type ArtsyBackdrop, type CollageConfig } from "./manifest";
import {
  ARTSY_TRANSITIONS,
  CLEAN_TRANSITIONS,
  isPerPhoto,
  TRANSITION_LABELS,
  TRANSITION_ORDER_LABELS,
  TRANSITION_ORDERS,
  TRANSITION_SPEED_MAX,
  TRANSITION_SPEED_MIN,
  transitionFor,
  type CollageTransition,
} from "./transitions";

const BACKDROP_LABELS: Record<ArtsyBackdrop, string> = {
  none: "None — the background shows through",
  cork: "Cork",
  lightWood: "Light wood",
  darkWood: "Dark wood",
  linen: "Linen",
  kraft: "Kraft paper",
  solid: "Solid colour",
};

/** A row of toggle buttons for a short list of choices. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className={PANEL_LABEL}>{label}</span>
      <div className="flex gap-2">
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`${CHROME_BUTTON} flex-1 border ${value === option ? `${CHROME_BUTTON_ON} border-transparent` : "border-paper/20"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  const artsy = config.style === "artsy";
  const transitions: readonly CollageTransition[] = artsy ? ARTSY_TRANSITIONS : CLEAN_TRANSITIONS;
  const transition = transitionFor(config.style, config.transition);
  const maxCount = artsy ? 10 : 14;
  const fastenable = config.artsyFrame === "taped" || config.artsyFrame === "pinned" || config.artsyFrame === "mixed";

  return (
    <div className="flex flex-col gap-4">
      <AlbumsField value={config} onChange={onChange} />

      <Choice
        label="Style"
        value={config.style}
        options={[
          ["clean", "Clean"],
          ["artsy", "Artsy"],
        ]}
        onChange={(style) =>
          onChange({
            style,
            // Keep a transition the new style offers, or take its default.
            transition: transitionFor(style, config.transition),
            ...(style === "artsy" && config.exactCount > 10 ? { exactCount: 10 } : {}),
          })
        }
      />

      {artsy && (
        <>
          <label className="flex flex-col gap-1">
            <span className={PANEL_LABEL}>Frame</span>
            <select
              value={config.artsyFrame}
              onChange={(event) => onChange({ artsyFrame: event.target.value as CollageConfig["artsyFrame"] })}
              className={PANEL_CONTROL}
            >
              {FRAME_STYLES.map((style) => (
                <option key={style} value={style}>
                  {FRAME_LABELS[style]}
                </option>
              ))}
            </select>
          </label>
          <Choice
            label="Tilt"
            value={config.artsyTilt}
            options={[
              ["none", "None"],
              ["subtle", "Subtle"],
              ["playful", "Playful"],
            ]}
            onChange={(artsyTilt) => onChange({ artsyTilt })}
          />
          <Choice
            label="Overlap"
            value={config.artsyOverlap}
            options={[
              ["none", "None"],
              ["slight", "Slight"],
            ]}
            onChange={(artsyOverlap) => onChange({ artsyOverlap })}
          />
          {config.artsyTilt === "none" && config.artsyOverlap === "none" && (
            <span className={PANEL_LABEL}>Straight and apart: a gallery wall.</span>
          )}
          <label className="flex flex-col gap-1">
            <span className={PANEL_LABEL}>Backdrop</span>
            <select
              value={config.artsyBackdrop}
              onChange={(event) => onChange({ artsyBackdrop: event.target.value as ArtsyBackdrop })}
              className={PANEL_CONTROL}
            >
              {ARTSY_BACKDROPS.map((backdrop) => (
                <option key={backdrop} value={backdrop}>
                  {BACKDROP_LABELS[backdrop]}
                </option>
              ))}
            </select>
          </label>
          {config.artsyBackdrop === "solid" && (
            <ColorField
              label="Backdrop colour"
              value={config.artsyBackdropColor}
              onChange={(artsyBackdropColor) => onChange({ artsyBackdropColor })}
            />
          )}
          <Choice
            label="Shadow"
            value={config.artsyShadow}
            options={[
              ["soft", "Soft"],
              ["medium", "Medium"],
              ["strong", "Strong"],
            ]}
            onChange={(artsyShadow) => onChange({ artsyShadow })}
          />
          {fastenable && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.artsyFasteners}
                onChange={(event) => onChange({ artsyFasteners: event.target.checked })}
                className={PANEL_CHECKBOX}
              />
              <span className={PANEL_LABEL}>Tape and pins</span>
            </label>
          )}
        </>
      )}

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
          <option value="medium">{artsy ? "Medium (4–7)" : "Medium (4–8)"}</option>
          <option value="many">{artsy ? "Many (7–10)" : "Many (8–14)"}</option>
          <option value="exact">Exactly…</option>
        </select>
      </label>
      {config.density === "exact" && (
        <NumberField
          label="Photos on each page"
          value={config.exactCount}
          onChange={(exactCount) => onChange({ exactCount })}
          min={1}
          max={maxCount}
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
          value={transition}
          onChange={(event) => onChange({ transition: event.target.value as CollageConfig["transition"] })}
          className={PANEL_CONTROL}
        >
          {transitions.map((option) => (
            <option key={option} value={option}>
              {TRANSITION_LABELS[option]}
            </option>
          ))}
        </select>
      </label>

      {!artsy && isPerPhoto(transition) && (
        <label className="flex flex-col gap-1">
          <span className={PANEL_LABEL}>Photo order</span>
          <select
            value={config.transitionOrder}
            onChange={(event) => onChange({ transitionOrder: event.target.value as CollageConfig["transitionOrder"] })}
            className={PANEL_CONTROL}
          >
            {TRANSITION_ORDERS.map((order) => (
              <option key={order} value={order}>
                {TRANSITION_ORDER_LABELS[order]}
              </option>
            ))}
          </select>
        </label>
      )}
      {transition !== "none" && (
        <SliderField
          label="Transition speed"
          value={Math.round(config.transitionSpeed * 100)}
          min={TRANSITION_SPEED_MIN * 100}
          max={TRANSITION_SPEED_MAX * 100}
          step={10}
          onChange={(pct) => onChange({ transitionSpeed: pct / 100 })}
          format={(pct) =>
            pct === 100 ? "Normal" : pct > 100 ? `${(pct / 100).toFixed(1)}× faster` : `${(100 / pct).toFixed(1)}× slower`
          }
        />
      )}

      {/* Clean only: Artsy spaces its prints itself and dresses them in frames. */}
      {!artsy && (
        <>
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
        </>
      )}

      {/* ONE background: the widget's own, on the Appearance tab — it shows in
          the gaps and in any space the photos don't fill. A collage saved with
          the old separate inner colour can move it there in one click. */}
      {config.leftoverColor ? (
        <div className="flex flex-col gap-2">
          <span className={PANEL_LABEL}>
            This collage has its own background colour from an earlier version. Backgrounds now live on the
            Appearance tab, with the rest of the frame.
          </span>
          <button
            type="button"
            className={`${CHROME_BUTTON} border-paper/20 border`}
            onClick={() =>
              onChange({ background: config.background || config.leftoverColor, backgroundOpacity: config.background ? config.backgroundOpacity : 100, leftoverColor: "" })
            }
          >
            Move it to Appearance
          </button>
        </div>
      ) : (
        <span className={PANEL_LABEL}>
          The background behind the photos is set on the Appearance tab. It shows in the gaps and anywhere the
          photos don&rsquo;t reach.
        </span>
      )}
    </div>
  );
}
