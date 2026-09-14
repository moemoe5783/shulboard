"use client";

import { BOARD_FONT_OPTIONS } from "@/lib/board-theme";
import { FRAME_PRESETS, type WidgetFont, type WidgetStyleConfig } from "@/widgets/style";
import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "./panelControls";
import { SliderField } from "./SliderField";

/*
 * The Appearance tab — one generic control set for EVERY widget's design
 * (background, transparency, corner radius, padding, border, shadow, colour,
 * font and a header), rendered by the properties panel rather than repeated in
 * each widget's Settings.tsx. It reads and writes the style fields every widget
 * spreads into its config (widgets/style.ts).
 *
 * FRIENDLY BY DESIGN. The two lengths a gabbai is least likely to have a feel
 * for — corner radius and padding — are sliders they can drag and watch, not
 * number boxes; transparency is a percentage slider; and the ready-made frames
 * at the top mean most boards never touch an individual control at all. The
 * VALUES chosen here are board content and may be any colour (design.md §1b);
 * the controls themselves are chrome and follow the dark-panel geometry.
 */

/** Where a freshly-enabled colour starts, before the gabbai edits it — values,
 *  not tokens, because this is board content. */
const DEFAULT_BACKGROUND = "#1b2a2e";
const DEFAULT_TEXT_COLOR = "#f2f4f3";
const DEFAULT_BORDER_COLOR = "#1b2a2e";

export function AppearanceControls({
  config,
  onChange,
}: {
  config: WidgetStyleConfig;
  onChange: (patch: Partial<WidgetStyleConfig>) => void;
}) {
  const hasBackground = config.background !== "";
  const hasTextColor = config.textColor !== "";
  const hasBorder = config.borderWidth > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Ready-made frames — pick one, then adjust anything below. */}
      <div className="flex flex-col gap-2">
        <span className={PANEL_LABEL}>Frame</span>
        <div className="grid grid-cols-3 gap-2">
          {FRAME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(preset.patch)}
              className="border-paper/15 hover:border-paper/40 flex flex-col items-center gap-1 rounded-[6px] border p-1.5"
              title={preset.label}
            >
              <span className="h-7 w-full rounded-[4px]" style={preset.swatch} />
              <span className="text-meta text-paper/70">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Header — the title above the widget, like "Zmanim" over the table. */}
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className={PANEL_LABEL}>Header</span>
          <input
            type="text"
            value={config.title}
            placeholder="No header"
            onChange={(event) => onChange({ title: event.target.value })}
            className={PANEL_CONTROL}
          />
        </label>
        {config.title !== "" && (
          <SliderField
            label="Header size"
            value={config.titleSize}
            min={12}
            max={200}
            onChange={(titleSize) => onChange({ titleSize })}
          />
        )}
      </div>

      {/* Background + its transparency. */}
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
          <div className="flex flex-col gap-3 pl-6">
            <label className="flex items-center gap-2">
              <input
                type="color"
                value={config.background}
                onChange={(event) => onChange({ background: event.target.value })}
                className="border-paper/20 h-8 w-12 rounded-[5px] border bg-transparent"
                aria-label="Background colour"
              />
              <span className={PANEL_LABEL}>Colour</span>
            </label>
            <SliderField
              label="Transparency"
              value={100 - config.backgroundOpacity}
              min={0}
              max={100}
              onChange={(transparency) => onChange({ backgroundOpacity: 100 - transparency })}
              format={(v) => `${v}%`}
            />
          </div>
        )}
      </div>

      {/* Corner radius + padding — the two a slider serves best. */}
      <SliderField
        label="Corner radius"
        value={config.radius}
        min={0}
        max={160}
        onChange={(radius) => onChange({ radius })}
      />
      <SliderField label="Padding" value={config.padding} min={0} max={160} onChange={(padding) => onChange({ padding })} />

      {/* Border. */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hasBorder}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? { borderWidth: 3, borderColor: config.borderColor || DEFAULT_BORDER_COLOR }
                  : { borderWidth: 0 },
              )
            }
            className={PANEL_CHECKBOX}
          />
          <span className="text-cell text-paper">Border</span>
        </label>
        {hasBorder && (
          <div className="flex flex-col gap-3 pl-6">
            <SliderField
              label="Thickness"
              value={config.borderWidth}
              min={1}
              max={40}
              onChange={(borderWidth) => onChange({ borderWidth })}
            />
            <label className="flex items-center gap-2">
              <input
                type="color"
                value={config.borderColor || DEFAULT_BORDER_COLOR}
                onChange={(event) => onChange({ borderColor: event.target.value })}
                className="border-paper/20 h-8 w-12 rounded-[5px] border bg-transparent"
                aria-label="Border colour"
              />
              <span className={PANEL_LABEL}>Colour</span>
            </label>
          </div>
        )}
      </div>

      {/* Shadow — a floating look. Board content, so allowed (design.md §1b). */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.shadow}
          onChange={(event) => onChange({ shadow: event.target.checked })}
          className={PANEL_CHECKBOX}
        />
        <span className="text-cell text-paper">Drop shadow</span>
      </label>

      {/* Text colour. */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hasTextColor}
            onChange={(event) => onChange({ textColor: event.target.checked ? DEFAULT_TEXT_COLOR : "" })}
            className={PANEL_CHECKBOX}
          />
          <span className="text-cell text-paper">Text colour</span>
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
            <span className={PANEL_LABEL}>Colour</span>
          </label>
        )}
      </div>

      {/* Font — the board faces, in the order the menu shows them. */}
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Font</span>
        <select
          value={config.font}
          onChange={(event) => onChange({ font: event.target.value as WidgetFont })}
          className={PANEL_CONTROL}
        >
          <option value="inherit">Board default</option>
          {BOARD_FONT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
