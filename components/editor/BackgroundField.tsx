"use client";

import { useState } from "react";
import {
  BACKGROUND_CATEGORIES,
  BACKGROUND_PRESETS,
  backgroundCss,
  backgroundKind,
  backgroundTone,
  DEFAULT_GRADIENT,
  gradientCss,
  parseGradient,
  type BackgroundTone,
  type GradientSpec,
} from "@/lib/board-background";
import { ColorField, ColorPicker } from "./ColorField";
import { PANEL_CONTROL, PANEL_LABEL } from "./panelControls";
import { SliderField } from "./SliderField";

/*
 * A background for the board or for a widget's frame: a colour, a gradient, or
 * one from the library (lib/board-background.ts). One control for both places,
 * writing the same single-string value, so a background means the same thing
 * wherever it's set.
 *
 * `onChange` also reports the new background's tone, so the caller can keep
 * text readable (the board panel switches the board's text to light on a dark
 * background).
 */

type Tab = "color" | "gradient" | "library";

const DEFAULT_COLOR = "#1b2a2e";

export function BackgroundField({
  value,
  onChange,
  allowNone = true,
}: {
  value: string;
  onChange: (value: string, tone: BackgroundTone | null) => void;
  /** Offer "None" (transparent). */
  allowNone?: boolean;
}) {
  const kind = backgroundKind(value);
  const [tab, setTab] = useState<Tab>(kind === "gradient" ? "gradient" : kind === "preset" ? "library" : "color");
  const set = (next: string) => onChange(next, backgroundTone(next));

  return (
    <div className="flex flex-col gap-2" data-background-field>
      <div className="flex items-center gap-2">
        <span
          className="border-paper/25 h-9 w-14 shrink-0 rounded-[5px] border"
          style={{ background: backgroundCss(value) ?? "repeating-conic-gradient(var(--ink-faint) 0 25%, transparent 0 50%) 0 0 / 12px 12px" }}
          aria-hidden
        />
        <span className="text-meta text-paper/70 min-w-0 flex-1 truncate">{describe(value)}</span>
        {allowNone && kind !== "none" && (
          <button type="button" className="text-meta text-paper/60 hover:text-paper underline" onClick={() => set("")}>
            None
          </button>
        )}
      </div>

      <div className="flex gap-1" role="tablist">
        {(
          [
            ["color", "Colour"],
            ["gradient", "Gradient"],
            ["library", "Library"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`text-meta flex-1 rounded-[5px] px-2 py-1 ${tab === id ? "bg-paper/15 text-paper" : "text-paper/60 hover:text-paper"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "color" && (
        <ColorPicker label="Background colour" value={kind === "color" ? value : DEFAULT_COLOR} onChange={set} />
      )}
      {tab === "gradient" && <GradientEditor value={value} onChange={set} />}
      {tab === "library" && <Library value={value} onChange={set} />}
    </div>
  );
}

function describe(value: string): string {
  switch (backgroundKind(value)) {
    case "none":
      return "None — the board shows through";
    case "color":
      return value;
    case "gradient":
      return "Gradient";
    case "preset":
      return BACKGROUND_PRESETS.find((preset) => `preset:${preset.id}` === value)?.name ?? "Library background";
  }
}

function GradientEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const spec: GradientSpec = parseGradient(value) ?? DEFAULT_GRADIENT;
  const update = (patch: Partial<GradientSpec>) => onChange(gradientCss({ ...spec, ...patch }));
  const setStop = (index: number, color: string) =>
    update({ stops: spec.stops.map((stop, i) => (i === index ? { ...stop, color } : stop)) });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Shape</span>
        <select
          value={spec.type}
          onChange={(event) => update({ type: event.target.value as GradientSpec["type"] })}
          className={PANEL_CONTROL}
        >
          <option value="linear">Straight</option>
          <option value="radial">Glow from the centre</option>
        </select>
      </label>
      {spec.type === "linear" && (
        <SliderField label="Direction" value={spec.angle} min={0} max={359} onChange={(angle) => update({ angle })} format={(v) => `${v}°`} />
      )}
      <div className="flex flex-col gap-2">
        <span className={PANEL_LABEL}>Colours</span>
        {spec.stops.map((stop, index) => (
          <div key={index} className="flex items-center gap-2">
            <ColorField label={`Gradient colour ${index + 1}`} value={stop.color} onChange={(color) => setStop(index, color)} />
            {spec.stops.length > 2 && (
              <button
                type="button"
                className="text-meta text-paper/60 hover:text-paper underline"
                onClick={() => update({ stops: spreadStops(spec.stops.filter((_, i) => i !== index)) })}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {spec.stops.length < 4 && (
          <button
            type="button"
            className="text-meta text-paper/70 hover:text-paper self-start underline"
            onClick={() => update({ stops: spreadStops([...spec.stops, { color: spec.stops[spec.stops.length - 1].color, at: 100 }]) })}
          >
            Add a colour
          </button>
        )}
      </div>
    </div>
  );
}

/** Space stops evenly from 0% to 100%. */
function spreadStops(stops: GradientSpec["stops"]): GradientSpec["stops"] {
  return stops.map((stop, i) => ({ ...stop, at: stops.length === 1 ? 0 : (i / (stops.length - 1)) * 100 }));
}

function Library({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex max-h-96 flex-col gap-3 overflow-auto pr-1" data-background-library>
      {BACKGROUND_CATEGORIES.map((category) => (
        <div key={category} className="flex flex-col gap-1.5">
          <span className={PANEL_LABEL}>{category}</span>
          <div className="grid grid-cols-3 gap-1.5">
            {BACKGROUND_PRESETS.filter((preset) => preset.category === category).map((preset) => {
              const id = `preset:${preset.id}`;
              const chosen = value === id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.name}
                  aria-label={preset.name}
                  aria-pressed={chosen}
                  onClick={() => onChange(id)}
                  className={`aspect-video w-full rounded-[5px] border-2 ${chosen ? "border-verdigris" : "hover:border-paper/40 border-transparent"}`}
                  style={{ background: preset.css }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
