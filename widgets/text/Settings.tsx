"use client";

import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import { SliderField } from "@/components/editor/SliderField";
import { readConfig } from "@/widgets/read-config";
import type { AppearanceSection, WidgetSettingsProps } from "@/widgets/types";
import { textConfigSchema, type TextConfig } from "./manifest";

export function Settings({ config: raw, onChange }: WidgetSettingsProps<TextConfig>) {
  const config = readConfig(textConfigSchema, raw);
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Text</span>
        <textarea
          value={config.text}
          maxLength={5000}
          rows={6}
          onChange={(event) => onChange({ text: event.target.value })}
          className="text-cell rounded-control text-paper border-paper/20 bg-ink w-full border px-2 py-1.5 leading-snug"
        />
      </label>

      {/* The type size and Fixed / Hug / Fit live on the Size tab, as for every
          text element (PropertiesPanel.tsx). */}
    </div>
  );
}

/** How the text is set — alignment, where it sits, spacing, weight — at the top of the Appearance tab's Text section. */
function TextLayout({ config: raw, onChange }: WidgetSettingsProps<TextConfig>) {
  const config = readConfig(textConfigSchema, raw);
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Alignment</span>
        <select
          value={config.align}
          onChange={(event) => onChange({ align: event.target.value as TextConfig["align"] })}
          className={PANEL_CONTROL}
        >
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
          <option value="justify">Justified</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Position in the box</span>
        <select
          value={config.verticalAlign}
          onChange={(event) => onChange({ verticalAlign: event.target.value as TextConfig["verticalAlign"] })}
          className={PANEL_CONTROL}
        >
          <option value="top">Top</option>
          <option value="middle">Middle</option>
          <option value="bottom">Bottom</option>
        </select>
      </label>

      <SliderField
        label="Line spacing"
        value={Math.round(config.lineHeight * 100)}
        min={90}
        max={250}
        step={5}
        onChange={(pct) => onChange({ lineHeight: pct / 100 })}
        format={(pct) => (pct / 100).toFixed(2)}
      />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.bold}
          onChange={(event) => onChange({ bold: event.target.checked })}
          className={PANEL_CHECKBOX}
        />
        <span className="text-cell text-paper">Bold</span>
      </label>
    </div>
  );
}

export const appearance: AppearanceSection<TextConfig>[] = [{ id: "text", label: "Text", Component: TextLayout }];
