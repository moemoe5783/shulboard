"use client";

import { NumberField } from "@/components/editor/NumberField";
import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { WidgetSettingsProps } from "@/widgets/types";
import { AlbumField } from "../media/AlbumField";
import type { GalleryConfig } from "./manifest";

export function Settings({ config, onChange }: WidgetSettingsProps<GalleryConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <AlbumField value={config.albumId} onChange={(albumId) => onChange({ albumId })} />

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
