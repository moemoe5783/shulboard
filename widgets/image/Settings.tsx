"use client";

import { NumberField } from "@/components/editor/NumberField";
import { PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { WidgetSettingsProps } from "@/widgets/types";
import type { ImageConfig } from "./manifest";

/*
 * A URL, not an album picker.
 *
 * §6's upload pipeline and album binding don't exist yet — assetId is here in
 * the schema for when they do, but nothing generates one today. Setting `src`
 * directly is the honest stand-in: it is exactly the field the bundle and the
 * renderer already read, and a board does not have to wait on the media
 * pipeline to show a picture.
 */
export function Settings({ config, onChange }: WidgetSettingsProps<ImageConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Image URL</span>
        <input
          type="text"
          value={config.src}
          placeholder="https://…"
          maxLength={2048}
          onChange={(event) => onChange({ src: event.target.value })}
          className={PANEL_CONTROL}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Alt text</span>
        <input
          type="text"
          value={config.alt}
          maxLength={300}
          onChange={(event) => onChange({ alt: event.target.value })}
          className={PANEL_CONTROL}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Fit</span>
        <select
          value={config.fit}
          onChange={(event) => onChange({ fit: event.target.value as ImageConfig["fit"] })}
          className={PANEL_CONTROL}
        >
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
        </select>
      </label>

      <NumberField
        label="Corner radius"
        value={config.radius}
        onChange={(radius) => onChange({ radius })}
        min={0}
        max={200}
      />
    </div>
  );
}
