"use client";

import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { AppearanceSection, WidgetSettingsProps } from "@/widgets/types";
import type { ParshaConfig } from "./manifest";

export function Settings({ config, onChange }: WidgetSettingsProps<ParshaConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Script</span>
        <select
          value={config.script}
          onChange={(event) => onChange({ script: event.target.value as ParshaConfig["script"] })}
          className={PANEL_CONTROL}
        >
          <option value="hebrew">Hebrew</option>
          <option value="transliterated">Transliterated</option>
          <option value="both">Both</option>
        </select>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.nekudos}
          disabled={config.script === "transliterated"}
          onChange={(event) => onChange({ nekudos: event.target.checked })}
          className={`${PANEL_CHECKBOX} disabled:opacity-40`}
        />
        <span className="text-cell text-paper">Nekudos</span>
      </label>
    </div>
  );
}

/** Where the text sits in its box — at the top of the Appearance tab's Text section. */
function ParshaText({ config, onChange }: WidgetSettingsProps<ParshaConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Alignment</span>
        <select
          value={config.align}
          onChange={(event) => onChange({ align: event.target.value as ParshaConfig["align"] })}
          className={PANEL_CONTROL}
        >
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
        </select>
      </label>
    </div>
  );
}

export const appearance: AppearanceSection<ParshaConfig>[] = [{ id: "text", label: "Text", Component: ParshaText }];
