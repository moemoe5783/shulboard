"use client";

import { PANEL_LABEL } from "./panelControls";

/*
 * A labelled range slider with its value shown inline — the friendly version of
 * a number box for the appearance controls (corner radius, padding, transparency
 * and the header size). A gabbai who has never met the phrase "corner radius"
 * can drag it and watch the board change, which is the whole point of using a
 * slider here rather than the number field the sizing controls use.
 *
 * Like NumberField, every step commits through the store's one mutation path, so
 * a drag is live on the canvas and undoable. That means a drag lays down several
 * undo entries — the same accepted rough edge NumberField's per-keystroke commit
 * has (lib/editor/store.ts), and a much smaller problem than trying to coalesce
 * a preview outside commit(), which that comment explains is broken by
 * construction.
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** How the current value reads next to the label — "24px", "60%". Defaults
   *  to the bare number. */
  format?: (value: number) => string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between">
        <span className={PANEL_LABEL}>{label}</span>
        <span className="text-meta text-paper/80 numeric">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-verdigris h-4 w-full"
      />
    </label>
  );
}
