"use client";

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
