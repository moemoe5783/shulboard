"use client";

import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { WidgetSettingsProps } from "@/widgets/types";
import type { HebrewDateConfig } from "./manifest";

export function Settings({ config, onChange }: WidgetSettingsProps<HebrewDateConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Script</span>
        <select
          value={config.script}
          onChange={(event) => onChange({ script: event.target.value as HebrewDateConfig["script"] })}
          className={PANEL_CONTROL}
        >
          <option value="hebrew">Hebrew</option>
          <option value="transliterated">Transliterated</option>
          <option value="both">Both</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Numerals</span>
        <select
          value={config.numerals}
          disabled={config.script === "transliterated"}
          title={config.script === "transliterated" ? "Only affects the Hebrew line." : undefined}
          onChange={(event) => onChange({ numerals: event.target.value as HebrewDateConfig["numerals"] })}
          className={`${PANEL_CONTROL} disabled:opacity-40`}
        >
          <option value="gematria">Gematria</option>
          <option value="latin">Latin</option>
        </select>
      </label>

      {/* Only meaningful with gematria numerals — ה׳ prepended to a Latin
          "5786" isn't a thing anyone writes (lib/hebrew/format.ts). */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.yearPrefix}
          disabled={config.numerals !== "gematria" || config.script === "transliterated"}
          onChange={(event) => onChange({ yearPrefix: event.target.checked })}
          className={`${PANEL_CHECKBOX} disabled:opacity-40`}
        />
        <span className="text-cell text-paper">Year starts with ה׳</span>
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
          checked={config.sunsetRollover}
          onChange={(event) => onChange({ sunsetRollover: event.target.checked })}
          className={PANEL_CHECKBOX}
        />
        <span className="text-cell text-paper">Flip at sunset, not midnight</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Alignment</span>
        <select
          value={config.align}
          onChange={(event) => onChange({ align: event.target.value as HebrewDateConfig["align"] })}
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
