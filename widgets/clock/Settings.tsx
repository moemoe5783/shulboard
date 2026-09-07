"use client";

import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { WidgetSettingsProps } from "@/widgets/types";
import type { ClockConfig } from "./manifest";

export function Settings({ config, onChange }: WidgetSettingsProps<ClockConfig>) {
  return (
    <div className="flex flex-col gap-4">
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
          checked={config.showSeconds}
          onChange={(event) => onChange({ showSeconds: event.target.checked })}
          className={PANEL_CHECKBOX}
        />
        <span className="text-cell text-paper">Show seconds</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Time zone</span>
        <input
          type="text"
          value={config.timeZone}
          placeholder="This device's own"
          maxLength={64}
          onChange={(event) => onChange({ timeZone: event.target.value })}
          className={PANEL_CONTROL}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Alignment</span>
        <select
          value={config.align}
          onChange={(event) => onChange({ align: event.target.value as ClockConfig["align"] })}
          className={PANEL_CONTROL}
        >
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Size</span>
        <input
          type="number"
          min={8}
          max={400}
          value={config.size}
          disabled={config.sizingMode === "fit"}
          title={
            config.sizingMode === "fit"
              ? "Set by the box while it's in fit mode — see Sizing above."
              : undefined
          }
          onChange={(event) => onChange({ size: Number(event.target.value) })}
          className={`${PANEL_CONTROL} numeric disabled:opacity-40`}
        />
      </label>
    </div>
  );
}
