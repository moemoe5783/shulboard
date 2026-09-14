"use client";

import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { WidgetFont, WidgetStyleConfig } from "./style";

/*
 * The appearance controls shared by the widgets that offer a background, text
 * colour and font (zmanim, candle lighting) — one copy, so the two panels
 * can't drift.
 *
 * The colour inputs are native `<input type="color">`, paired with a toggle:
 * the input can only ever hold a hex, so a checkbox is what expresses "none"
 * (transparent background) and "board default" (inherited text colour). The
 * VALUES are board content and may be any colour (design.md §1b); the controls
 * themselves are chrome and follow the dark-panel geometry like every other.
 */

/** Enabling the background starts from a dark neutral the gabbai then edits —
 *  a value, not a token, because this is board content. */
const DEFAULT_BACKGROUND = "#1b2a2e";
const DEFAULT_TEXT_COLOR = "#f2f4f3";

export function StyleControls({
  config,
  onChange,
}: {
  config: WidgetStyleConfig;
  onChange: (patch: Partial<WidgetStyleConfig>) => void;
}) {
  const hasBackground = config.background !== "";
  const hasTextColor = config.textColor !== "";

  return (
    <div className="border-paper/15 flex flex-col gap-4 border-t pt-4">
      <span className={PANEL_LABEL}>Appearance</span>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hasBackground}
            onChange={(event) => onChange({ background: event.target.checked ? DEFAULT_BACKGROUND : "" })}
            className={PANEL_CHECKBOX}
          />
          <span className="text-cell text-paper">Background</span>
        </label>

        {hasBackground && (
          <div className="flex flex-col gap-2 pl-6">
            <label className="flex items-center gap-2">
              <input
                type="color"
                value={config.background}
                onChange={(event) => onChange({ background: event.target.value })}
                className="border-paper/20 h-8 w-12 rounded-[5px] border bg-transparent"
                aria-label="Background colour"
              />
              <span className={PANEL_LABEL}>Background colour</span>
            </label>

            <label className="flex flex-col gap-1">
              <span className={PANEL_LABEL}>Padding</span>
              <input
                type="number"
                min={0}
                max={400}
                value={config.padding}
                onChange={(event) => onChange({ padding: clamp(event.target.value, 0, 400) })}
                className={PANEL_CONTROL}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={PANEL_LABEL}>Corner radius</span>
              <input
                type="number"
                min={0}
                max={400}
                value={config.radius}
                onChange={(event) => onChange({ radius: clamp(event.target.value, 0, 400) })}
                className={PANEL_CONTROL}
              />
            </label>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hasTextColor}
            onChange={(event) => onChange({ textColor: event.target.checked ? DEFAULT_TEXT_COLOR : "" })}
            className={PANEL_CHECKBOX}
          />
          <span className="text-cell text-paper">Custom text colour</span>
        </label>
        {hasTextColor && (
          <label className="flex items-center gap-2 pl-6">
            <input
              type="color"
              value={config.textColor}
              onChange={(event) => onChange({ textColor: event.target.value })}
              className="border-paper/20 h-8 w-12 rounded-[5px] border bg-transparent"
              aria-label="Text colour"
            />
            <span className={PANEL_LABEL}>Text colour</span>
          </label>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Font</span>
        <select
          value={config.font}
          onChange={(event) => onChange({ font: event.target.value as WidgetFont })}
          className={PANEL_CONTROL}
        >
          <option value="inherit">Board default</option>
          <option value="assistant">Assistant</option>
          <option value="sefarim">Frank Ruhl Libre</option>
          <option value="system">System</option>
        </select>
      </label>
    </div>
  );
}

/** A number input's string value, clamped to the field's range; a blank or
 *  non-numeric entry falls back to the minimum rather than NaN. */
function clamp(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}
