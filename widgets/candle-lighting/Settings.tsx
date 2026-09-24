"use client";

import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { AppearanceSection, WidgetSettingsProps } from "@/widgets/types";
import type { CandleLightingConfig } from "./manifest";

export function Settings({ config, onChange }: WidgetSettingsProps<CandleLightingConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Show</span>
        <select
          value={config.displayMode}
          onChange={(event) => onChange({ displayMode: event.target.value as CandleLightingConfig["displayMode"] })}
          className={PANEL_CONTROL}
        >
          <option value="next">Next only</option>
          <option value="all">All upcoming this week</option>
          <option value="rotate">Rotate through the week</option>
        </select>
        {config.displayMode === "all" && (
          <span className={PANEL_LABEL}>
            Stacked and fit to the box — the type shrinks so a busier week around Yom Tov stays visible. Set a type
            size on the Size tab to resize the box to it.
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
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.showShabbosEnd}
            onChange={(event) => onChange({ showShabbosEnd: event.target.checked })}
            className={PANEL_CHECKBOX}
          />
          <span className="text-cell text-paper">Show Shabbos end</span>
        </span>
        <span className={PANEL_LABEL}>
          The Havdalah time too, in order with the candle lighting. From Chabad.org&rsquo;s four-week feed.
        </span>
      </label>

      {/*
        THE "Zmanim source" SELECT AND THE "Calculate missing times"
        CHECKBOX BOTH STOOD HERE, and both are gone rather than reduced.

        Chabad.org is the only source (lib/zmanim/provider.ts), so the
        per-widget override had one option left — a one-item dropdown is a
        label that looks interactive. And with no Hebcal leg there is
        nothing to calculate, so a switch offering to calculate had one
        outcome too: a date Chabad has not published shows "No candle
        lighting time for this date".

        `config.provider` and `config.manualMinutesBeforeSunset` are still
        in the schema, unread — see manifest.ts on why a stored document
        keeps parsing and why re-offering the choice is a control here plus
        a read there, not a migration.

        The "Minutes before sunset" field that sat under them is gone for
        the same reason: Chabad publishes candle lighting 18 minutes before
        sunset itself, so there is nothing left for it to adjust.
      */}
    </div>
  );
}

/** Where the text sits in its box — at the top of the Appearance tab's Text section. */
function CandleLightingText({ config, onChange }: WidgetSettingsProps<CandleLightingConfig>) {
  return (
    <div className="flex flex-col gap-4">
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

export const appearance: AppearanceSection<CandleLightingConfig>[] = [{ id: "text", label: "Text", Component: CandleLightingText }];
