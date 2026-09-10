"use client";

import { NumberField } from "@/components/editor/NumberField";
import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { WidgetSettingsProps } from "@/widgets/types";
import type { CandleLightingConfig } from "./manifest";

export function Settings({ config, onChange }: WidgetSettingsProps<CandleLightingConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Show</span>
        <select
          value={config.displayMode}
          onChange={(event) => {
            const displayMode = event.target.value as CandleLightingConfig["displayMode"];
            /*
             * Picking "all" also switches the sizing mode to hug, and that
             * is the whole answer to how these two settings interact —
             * docs/sizing.md §2, and manifest.ts's own note on
             * `displayMode`.
             *
             * The week's entry count varies (one most weeks, two or three
             * around the chagim), which is §2's "content whose amount, not
             * whose row design, changes at runtime" — the case hug exists
             * for, and the only mode where overflow is structurally
             * impossible rather than something to warn about. Leaving it on
             * `fixed` would clip the busy week or waste the box the rest of
             * the year; `fit` would rescale between counts and overflow at
             * minFontSize anyway.
             *
             * Switching back to "next" does NOT undo it. Hug is a
             * defensible mode for a single entry too (manifest.ts says so),
             * and silently reverting a sizing choice the gabbai can see in
             * the panel would be worse than leaving it where it landed.
             */
            onChange(displayMode === "all" ? { displayMode, sizingMode: "hug" } : { displayMode });
          }}
          className={PANEL_CONTROL}
        >
          <option value="next">Next only</option>
          <option value="all">All upcoming this week</option>
          <option value="rotate">Rotate through the week</option>
        </select>
        {config.displayMode === "all" && (
          <span className={PANEL_LABEL}>
            Stacked, so the box hugs its own height — the week&rsquo;s count changes around Yom Tov.
          </span>
        )}
        {config.displayMode === "rotate" && (
          <span className={PANEL_LABEL}>One at a time, changing every 8 seconds.</span>
        )}
      </label>

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

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Zmanim source</span>
        <select
          value={config.provider}
          onChange={(event) => onChange({ provider: event.target.value as CandleLightingConfig["provider"] })}
          className={PANEL_CONTROL}
        >
          <option value="inherit">Use the screen&rsquo;s setting</option>
          <option value="hebcal">Hebcal</option>
          <option value="chabad">Chabad.org</option>
          <option value="manual">Manual</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.fallbackToCalculated}
            disabled={config.provider === "hebcal" || config.provider === "manual"}
            onChange={(event) => onChange({ fallbackToCalculated: event.target.checked })}
            className={`${PANEL_CHECKBOX} disabled:opacity-40`}
          />
          <span className="text-cell text-paper">Calculate missing times</span>
        </span>
        <span className={PANEL_LABEL}>
          {config.provider === "hebcal" || config.provider === "manual"
            ? "Only applies to Chabad.org, which is the one source that can be missing a date."
            : "Chabad.org times are fetched about three months ahead. With this off, a date outside that shows no time rather than a calculated one."}
        </span>
      </label>

      <NumberField
        label="Minutes before sunset"
        value={config.manualMinutesBeforeSunset}
        onChange={(manualMinutesBeforeSunset) => onChange({ manualMinutesBeforeSunset })}
        min={0}
        max={180}
        disabled={config.provider !== "manual"}
        title={config.provider !== "manual" ? "Only used when the source is Manual." : undefined}
      />
    </div>
  );
}
