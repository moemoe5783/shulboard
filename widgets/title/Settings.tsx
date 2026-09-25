"use client";

import { PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { AppearanceSection, WidgetSettingsProps } from "@/widgets/types";
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

      {/* No Size field here: a title always fits its box (docs/sizing.md §2) —
          the box is what you drag to make the title bigger or smaller. The
          properties panel still shows the computed type size, read-only,
          generically above this form — see PropertiesPanel.tsx's
          TypeSizeField. */}
    </div>
  );
}

/** Where the text sits in its box — at the top of the Appearance tab's Text section. */
function TitleText({ config, onChange }: WidgetSettingsProps<TitleConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Alignment</span>
        <select
          value={config.align}
          onChange={(event) => onChange({ align: event.target.value as TitleConfig["align"] })}
          className={PANEL_CONTROL}
        >
          <option value="start">Automatic — by language</option>
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
        </select>
      </label>
    </div>
  );
}

export const appearance: AppearanceSection<TitleConfig>[] = [{ id: "text", label: "Text", Component: TitleText }];
