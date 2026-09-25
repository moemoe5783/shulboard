"use client";

import { useState } from "react";
import { PANEL_LABEL } from "./panelControls";

/*
 * A labelled range slider with a number box beside it — drag it and watch the
 * board change, or type the exact value. A gabbai who has never met a word like
 * "padding" can still find the look by dragging, and one who knows the number
 * they want doesn't have to chase it with the mouse.
 *
 * The number box shows the slider's own value with `unit` after it ("%",
 * "°"). A slider whose value only makes sense in words (transition speed:
 * "2.0× faster") passes `format` instead and shows that as a readout, with no
 * box — typing "150" there would mean nothing to anyone.
 *
 * A typed value commits as you type when it's a number in range; anything else
 * waits, and leaving the box snaps it back into range (or to the last good
 * value). Like NumberField, every step commits through the store's one
 * mutation path, so a drag is live on the canvas and undoable — several undo
 * entries per drag, the accepted rough edge lib/editor/store.ts explains.
 */
export function SliderField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  format,
}: {
  label: string;
  /** One line under the label saying what the setting does. */
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown after the number box — "%", "°". */
  unit?: string;
  onChange: (value: number) => void;
  /** A readout in words, instead of the number box. */
  format?: (value: number) => string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-2">
        <span className={PANEL_LABEL}>{label}</span>
        {format ? (
          <span className="text-meta text-paper/80 numeric">{format(value)}</span>
        ) : (
          <span className="text-meta text-paper/80 flex items-center gap-1">
            <input
              type="number"
              inputMode="decimal"
              aria-label={label}
              min={min}
              max={max}
              step={step}
              value={draft ?? String(value)}
              onChange={(event) => {
                setDraft(event.target.value);
                const n = Number(event.target.value);
                if (event.target.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n);
              }}
              onBlur={() => {
                if (draft !== null) {
                  const n = Number(draft);
                  if (draft.trim() !== "" && Number.isFinite(n) && clamp(n) !== value) onChange(clamp(n));
                }
                setDraft(null);
              }}
              className="numeric rounded-control border-paper/20 bg-ink text-paper w-14 border px-1.5 py-0.5 text-right"
            />
            {unit && <span>{unit}</span>}
          </span>
        )}
      </span>
      {hint && <span className="text-meta text-paper/60">{hint}</span>}
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          setDraft(null);
          onChange(Number(event.target.value));
        }}
        className="accent-verdigris h-4 w-full"
      />
    </div>
  );
}
