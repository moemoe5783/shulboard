"use client";

import { PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { WidgetSettingsProps } from "@/widgets/types";
import type { TitleConfig } from "./manifest";

export function Settings({ config, onChange }: WidgetSettingsProps<TitleConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Text</span>
        <input
          type="text"
          value={config.text}
          maxLength={200}
          onChange={(event) => onChange({ text: event.target.value })}
          className={PANEL_CONTROL}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Subtitle</span>
        <input
          type="text"
          value={config.subtitle}
          maxLength={200}
          onChange={(event) => onChange({ subtitle: event.target.value })}
          className={PANEL_CONTROL}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Alignment</span>
        <select
          value={config.align}
          onChange={(event) => onChange({ align: event.target.value as TitleConfig["align"] })}
          className={PANEL_CONTROL}
        >
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
        </select>
      </label>

      {/* No Size field: a title always fits its box (docs/sizing.md §2) — the
          box is what you drag to make the title bigger or smaller. */}
    </div>
  );
}
