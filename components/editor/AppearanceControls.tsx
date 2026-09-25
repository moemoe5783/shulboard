"use client";

import type { ReactNode } from "react";
import { CHROME_BUTTON, CHROME_BUTTON_ON } from "@/app/(dev)/editor-lab/chrome";
import { FRAME_PRESETS, type WidgetFont, type WidgetStyleConfig } from "@/widgets/style";
import { FontSelect, HebrewFontSelect } from "./FontSelects";
import { FONT_ROLE_LABELS, resolveElementFont, type BoardFontRoles, type FontRole } from "@/lib/fonts/roles";
import { clampWeight, fontInfo, offeredWeights } from "@/lib/fonts";
import { fontStack } from "@/lib/fonts/stack";
import { useEditor } from "@/lib/editor/store";
import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "./panelControls";
import { backgroundKind } from "@/lib/board-background";
import { BackgroundField } from "./BackgroundField";
import { ColorField } from "./ColorField";
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
 *
 * IN SECTIONS, one showing at a time (the header lives with the rest of the
 * text), with every section's name in a row of
 * tabs at the top — so what else there is to set is visible at a glance
 * rather than found by scrolling. A widget adds its own look settings
 * (widgets/types.ts, AppearanceSection): a section of its own, listed first,
 * or controls at the top of a shared one.
 */

/** The shared sections, in tab order. */
export const SHARED_APPEARANCE_SECTIONS = [
  { id: "presets", label: "Presets" },
  { id: "background", label: "Background" },
  { id: "shape", label: "Shape" },
  { id: "text", label: "Text" },
] as const;

/** A widget's contribution, ready to render. */
export type AppearanceExtra = { id: string; label: string; node: ReactNode };

/** Where a freshly-enabled colour starts, before the gabbai edits it — values,
 *  not tokens, because this is board content. */
const DEFAULT_TEXT_COLOR = "#f2f4f3";
const DEFAULT_BORDER_COLOR = "#1b2a2e";

export function AppearanceControls({
  config,
  fonts,
  onChange,
  onFontPreview,
  extras = [],
  section,
  onSection,
}: {
  config: WidgetStyleConfig;
  /** The board's font roles, which one this element takes by default, and
   *  whether it shows times (no script faces offered). */
  fonts?: { roles: BoardFontRoles; role: FontRole; showsTimes: boolean; weighted: boolean };
  onChange: (patch: Partial<WidgetStyleConfig>) => void;
  /** A font hovered in a picker, shown on the canvas only — no undo entry
   *  until it's clicked (lib/editor/store.ts, fontPreview). */
  onFontPreview?: (patch: Partial<WidgetStyleConfig> | null) => void;
  /** The widget's own look settings (see AppearanceExtra above). */
  extras?: readonly AppearanceExtra[];
  /** Which section is showing — owned by the panel, so it stays put as the
   *  selection changes. Null or unknown falls back to the first. */
  section: string | null;
  onSection: (id: string) => void;
}) {
  const hasTextColor = config.textColor !== "";
  const openBoardPanel = useEditor((s) => s.openBoardPanel);
  const hasBorder = config.borderWidth > 0;
  const shared = new Set<string>(SHARED_APPEARANCE_SECTIONS.map((one) => one.id));
  const own = extras.filter((extra) => !shared.has(extra.id));
  const tabs = [...own.map(({ id, label }) => ({ id, label })), ...SHARED_APPEARANCE_SECTIONS];
  const active = tabs.some((tab) => tab.id === section) ? section! : tabs[0].id;
  const addedTo = (id: string) => extras.filter((extra) => extra.id === id).map((extra) => <div key={extra.label}>{extra.node}</div>);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="Appearance sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => onSection(tab.id)}
            className={`${CHROME_BUTTON} border px-1 ${active === tab.id ? `${CHROME_BUTTON_ON} border-transparent` : "border-paper/20"}`}
            data-appearance-tab={tab.id}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-5" data-appearance-section={active}>
        {own.find((extra) => extra.id === active)?.node}

        {active === "presets" && (
          <>
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

          </>
        )}

        {active === "background" && (
          <>
            {addedTo("background")}
      {/* Background — a colour or a gradient — and, for a plain colour, its
          transparency. */}
      <div className="flex flex-col gap-2">
        <span className={PANEL_LABEL}>Background</span>
        <BackgroundField value={config.background} onChange={(background) => onChange({ background })} />
        {backgroundKind(config.background) === "color" && (
          <SliderField
            label="Transparency"
            value={100 - config.backgroundOpacity}
            min={0}
            max={100}
            onChange={(transparency) => onChange({ backgroundOpacity: 100 - transparency })}
            unit="%"
          />
        )}
      </div>

          </>
        )}

        {active === "shape" && (
          <>
            {addedTo("shape")}
      {/* Corner radius (absolute) + padding (relative to the text size), named
          for what they do rather than what CSS calls them. */}
      <SliderField
        label="Rounded corners"
        hint="How round the frame's corners are."
        value={config.radius}
        min={0}
        max={160}
        onChange={(radius) => onChange({ radius })}
      />
      <SliderField
        label="Space inside the frame"
        hint="Room between the frame's edge and what's in it."
        value={Math.round(config.padding * 100)}
        min={0}
        max={200}
        step={5}
        onChange={(pct) => onChange({ padding: pct / 100 })}
        unit="%"
      />

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
            <ColorField
              label="Border colour"
              value={config.borderColor || DEFAULT_BORDER_COLOR}
              onChange={(borderColor) => onChange({ borderColor })}
            />
          </div>
        )}
      </div>

      {/* Shadow — a floating look. Board content, so allowed (design.md §1b). */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.shadow}
            onChange={(event) => onChange({ shadow: event.target.checked })}
            className={PANEL_CHECKBOX}
          />
          <span className="text-cell text-paper">Shadow behind the frame</span>
        </label>
        {config.shadow && (
          <div className="pl-6">
            <SliderField
              label="Shadow strength"
              hint="Light and close, or dark and spread out."
              value={config.shadowStrength}
              min={5}
              max={100}
              unit="%"
              onChange={(shadowStrength) => onChange({ shadowStrength })}
            />
          </div>
        )}
      </div>

          </>
        )}

        {active === "text" && (
          <>
            {addedTo("text")}
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
            value={Math.round(config.titleSize * 100)}
            min={50}
            max={300}
            step={5}
            onChange={(pct) => onChange({ titleSize: pct / 100 })}
            unit="%"
          />
        )}
      </div>

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
          <div className="pl-6">
            <ColorField label="Text colour" value={config.textColor} onChange={(textColor) => onChange({ textColor })} />
          </div>
        )}
      </div>

      {/* Font, and the face its Hebrew is drawn in (components/editor/FontSelects.tsx). */}
      <FontSelect
        value={config.font}
        inheritLabel={fonts ? `Theme ${FONT_ROLE_LABELS[fonts.role].toLowerCase()} font` : "Board default"}
        inheritFamily={fonts ? fontStack(fonts.roles[fonts.role].font, fonts.roles[fonts.role].hebrew) : undefined}
        roles={fonts?.roles}
        exclude={fonts?.showsTimes ? ["script"] : undefined}
        onChange={(font) => onChange({ font: font as WidgetFont })}
        onPreview={(font) => onFontPreview?.(font === null ? null : { font: font as WidgetFont })}
      />
      <button
        type="button"
        onClick={() => openBoardPanel("fonts")}
        className="text-meta text-paper/80 hover:text-paper self-start underline underline-offset-2"
        data-open-board-fonts-link
      >
        Change the board&rsquo;s fonts and font theme
      </button>
      {fonts?.weighted && <WeightSelect config={config} fonts={fonts} onChange={onChange} />}
      <HebrewFontSelect
        value={config.hebrewFont}
        inheritLabel="Theme's Hebrew font"
        onChange={(hebrewFont) => onChange({ hebrewFont })}
        onPreview={(hebrewFont) => onFontPreview?.(hebrewFont === null ? null : { hebrewFont })}
      />
          </>
        )}

      </div>
    </div>
  );
}

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};

/**
 * The weight of the element's text: only what its face offers, from its
 * minimum up — a thinner stroke vanishes on a TV across a room, so it isn't
 * offered at all (lib/fonts/catalog.ts, minWeight). A face with one weight
 * has nothing to choose, and says so.
 */
function WeightSelect({
  config,
  fonts,
  onChange,
}: {
  config: WidgetStyleConfig;
  fonts: { roles: BoardFontRoles; role: FontRole };
  onChange: (patch: Partial<WidgetStyleConfig>) => void;
}) {
  const { font } = resolveElementFont(config.font, config.hebrewFont, fonts.role, fonts.roles);
  const weights = offeredWeights(font);
  const name = fontInfo(font)?.name ?? "This font";
  if (weights.length <= 1) {
    return <p className={PANEL_LABEL}>{name} comes in one weight.</p>;
  }
  // A stored weight the face doesn't offer shows as the one it's drawn at.
  const value = config.fontWeight > 0 ? clampWeight(font, config.fontWeight) : 0;
  return (
    <label className="flex flex-col gap-1">
      <span className={PANEL_LABEL}>Weight</span>
      <select
        value={value}
        onChange={(event) => onChange({ fontWeight: Number(event.target.value) })}
        className={PANEL_CONTROL}
        data-weight-select
      >
        <option value={0}>Default</option>
        {weights.map((weight) => (
          <option key={weight} value={weight}>
            {WEIGHT_NAMES[weight] ?? weight}
          </option>
        ))}
      </select>
    </label>
  );
}
