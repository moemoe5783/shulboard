"use client";

import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { WidgetSettingsProps } from "@/widgets/types";
import type { CandleLightingConfig } from "./manifest";

export function Settings({ config, onChange }: WidgetSettingsProps<CandleLightingConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Label language</span>
        <select
          value={config.script}
          onChange={(event) => onChange({ script: event.target.value as CandleLightingConfig["script"] })}
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

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.hour12}
          onChange={(event) => onChange({ hour12: event.target.checked })}
          className={PANEL_CHECKBOX}
        />
        <span className="text-cell text-paper">12-hour</span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.showCountdown}
          onChange={(event) => onChange({ showCountdown: event.target.checked })}
          className={PANEL_CHECKBOX}
        />
        <span className="text-cell text-paper">Show countdown</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Alignment</span>
        <select
          value={config.align}
          onChange={(event) => onChange({ align: event.target.value as CandleLightingConfig["align"] })}
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
