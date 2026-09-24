"use client";

import { NumberField } from "@/components/editor/NumberField";
import { SliderField } from "@/components/editor/SliderField";
import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { WidgetSettingsProps } from "@/widgets/types";
import { AlbumsField } from "../media/AlbumField";
import { COLLAGE_TRANSITIONS, TRANSITION_SPEED_MAX, TRANSITION_SPEED_MIN, type CollageTransition } from "../collage/transitions";
import { readGalleryConfig, type GalleryConfig } from "./manifest";

/** The collage's effects, named for one photo rather than a page of them. */
const GALLERY_TRANSITION_LABELS: Record<CollageTransition, string> = {
  cascade: "Fade out, then in",
  rise: "Rise",
  zoom: "Zoom",
  slide: "Slide",
  crossfade: "Crossfade",
  fade: "Fade through the background",
  none: "None",
};

export function Settings({ config: raw, onChange }: WidgetSettingsProps<GalleryConfig>) {
  const config = readGalleryConfig(raw);
  return (
    <div className="flex flex-col gap-4">
      <AlbumsField value={config} onChange={onChange} />

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Fit</span>
        <select
          value={config.fit}
          onChange={(event) => onChange({ fit: event.target.value as GalleryConfig["fit"] })}
          className={PANEL_CONTROL}
        >
          <option value="cover">Fill the frame (crop)</option>
          <option value="contain">Fit the whole photo</option>
        </select>
      </label>

      <NumberField
        label="Seconds per photo"
        value={config.intervalSeconds}
        onChange={(intervalSeconds) => onChange({ intervalSeconds })}
        min={2}
        max={600}
      />

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Order</span>
        <select
          value={config.order}
          onChange={(event) => onChange({ order: event.target.value as GalleryConfig["order"] })}
          className={PANEL_CONTROL}
        >
          <option value="album">Album order</option>
          <option value="shuffle">Shuffle</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Transition</span>
        <select
          value={config.transition}
          onChange={(event) => onChange({ transition: event.target.value as GalleryConfig["transition"] })}
          className={PANEL_CONTROL}
        >
          {COLLAGE_TRANSITIONS.map((transition) => (
            <option key={transition} value={transition}>
              {GALLERY_TRANSITION_LABELS[transition]}
            </option>
          ))}
        </select>
      </label>

      {config.transition !== "none" && (
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

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.showCaption}
          onChange={(event) => onChange({ showCaption: event.target.checked })}
          className={PANEL_CHECKBOX}
        />
        <span className="text-cell text-paper">Show captions</span>
      </label>
    </div>
  );
}
