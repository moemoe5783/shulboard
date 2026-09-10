"use client";

import { useState } from "react";
import { PANEL_CONTROL, PANEL_LABEL } from "./panelControls";

/*
 * A numeric field that doesn't fight the person typing in it.
 *
 * THE BUG THIS EXISTS FOR — the "044" one. Every numeric input in the
 * editor was written as:
 *
 *     value={config.size}
 *     onChange={(e) => onChange(Number(e.target.value))}
 *
 * Clear that field and `e.target.value` is `""`, `Number("")` is 0, so the
 * config becomes 0 and the field re-renders as "0". Type 44 after it and
 * the DOM holds "044" — and here is the part that makes it stick rather
 * than self-correct: react-dom guards its write to a number input's value
 * with a LOOSE comparison (`node.value != value`). `"044" != 44` is false,
 * because `"044" == 44`, so React decides the DOM already agrees with it
 * and never rewrites "044" to "44". The leading zero survives every
 * subsequent render and has to be deleted by hand.
 *
 * THE FIX IS TO STOP ROUND-TRIPPING THROUGH `Number`. The input's value is
 * a string held locally, so what is on screen is always exactly what was
 * typed and React never has an opinion to lose. The parsed number is
 * pushed out separately, only when the text actually parses.
 *
 * Three behaviours that follow from that, all of which the old shape got
 * wrong:
 *
 * - An empty field STAYS empty. It does not become 0 mid-typing, so
 *   select-all-and-retype works the way it does in every other text field,
 *   and nothing downstream sees a spurious 0 (a font size of 0 is a widget
 *   that vanishes while you are still reaching for the first digit).
 * - Out-of-range text is not committed and not rewritten either. Typing
 *   "4" in a field whose minimum is 8 leaves "4" on screen and pushes
 *   nothing out; clamping on each keystroke instead would rewrite it to
 *   "8" under the cursor and make 44 unreachable by typing. Blur is where
 *   the clamp happens, which is the moment the person has finished saying
 *   what they meant.
 * - Blur resyncs the text to whatever actually got committed. That is what
 *   makes an abandoned empty or junk field snap back to the live value
 *   rather than sitting there looking like it saved something.
 *
 * Used by the properties panel, every widget Settings.tsx with a numeric
 * field, and editor-lab's toolbar — one implementation, because four
 * hand-rolled copies of this input are how three of them kept the bug.
 */

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  title,
  hint,
}: {
  label: string;
  /** The committed value. `undefined` renders an empty field — a widget
   *  whose config has no value for this yet, not a zero. */
  value: number | undefined;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  title?: string;
  hint?: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  // What this field itself last pushed out, so an incoming `value` can be
  // told apart from an echo of our own typing.
  const [committed, setCommitted] = useState(value);

  /*
   * Resync when `value` changes from OUTSIDE this field — an undo, a
   * different widget selected into the same panel, a sizing-mode switch
   * that rewrites `size`.
   *
   * Adjusted during render rather than in an effect, which is React's own
   * answer for "reset state when a prop changes" and what the compiler's
   * no-setState-in-effect rule is pointing at. React re-renders immediately
   * without committing the first pass, so there is no flash and no
   * cascading render.
   *
   * The `committed` comparison is what keeps it from fighting the typist:
   * every keystroke that parses also updates `committed`, so `value`
   * arriving back with the same number is recognised as our own echo and
   * leaves the text alone.
   */
  if (value !== committed) {
    setCommitted(value);
    setText(value === undefined ? "" : String(value));
  }

  const commit = (next: string) => {
    setText(next);
    // "" and "-" and "4e" are all legitimate things to have typed on the
    // way to a value, and none of them should reach the board document.
    const parsed = Number(next);
    if (next.trim() === "" || !Number.isFinite(parsed)) return;
    // Out of range stays on screen but is not committed — see the note
    // above on why clamping here would make the value unreachable.
    if (parsed < min || parsed > max) return;
    setCommitted(parsed);
    onChange(parsed);
  };

  const settle = () => {
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) {
      // Abandoned empty or junk: snap back to what is actually stored.
      setText(committed === undefined ? "" : String(committed));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setText(String(clamped));
    if (clamped !== committed) {
      setCommitted(clamped);
      onChange(clamped);
    }
  };

  return (
    <label className="flex flex-col gap-1">
      <span className={PANEL_LABEL}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        title={title}
        onChange={(event) => commit(event.target.value)}
        onBlur={settle}
        className={`${PANEL_CONTROL} numeric ${disabled ? "disabled:opacity-40" : ""}`}
      />
      {hint && <span className={PANEL_LABEL}>{hint}</span>}
    </label>
  );
}
