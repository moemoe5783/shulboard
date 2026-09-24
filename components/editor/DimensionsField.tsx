"use client";

import { CHROME_BUTTON, CHROME_BUTTON_ON, CHROME_META } from "@/app/(dev)/editor-lab/chrome";
import type { BoardWidget } from "@/lib/board-doc";
import { widgetRect } from "@/lib/editor/geometry";
import {
  describeRatio,
  fitToPreset,
  matchPresets,
  orientationOf,
  SIZE_PRESETS,
  type Orientation,
  type SizePresetGroup,
} from "@/lib/editor/size-presets";
import { useEditor } from "@/lib/editor/store";
import { NumberField } from "./NumberField";
import { PANEL_CONTROL, PANEL_LABEL } from "./panelControls";

/*
 * The selected element's size, and whether it's a photo or flyer shape
 * (lib/editor/size-presets.ts).
 *
 * The point is placeholders. A gabbai lays out a box for this week's flyer and
 * needs to tell whoever makes the flyer what to make: the shape (letter,
 * 4 × 6, …) and the pixels. So this says what the box is — a preset, or not
 * one and its plain size — and lets a preset be chosen to reshape it. After
 * that the box can still be dragged: a corner keeps the shape, an edge
 * changes it, and the moment it does this stops naming a preset.
 *
 * Sizes are board design units, which are the pixels of the board's own
 * canvas — what a picture made for the box should be to show 1:1.
 */

const GROUPS: SizePresetGroup[] = ["Photos", "Flyers and posters", "Screens"];

export function DimensionsField({ widget }: { widget: BoardWidget }) {
  const canvas = useEditor((s) => s.canvas);
  const applyRects = useEditor((s) => s.applyRects);
  const rect = widgetRect(widget, canvas);
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  const matches = matchPresets(rect.w, rect.h);
  const orientation = orientationOf(rect.w, rect.h);
  const square = w === h;

  const setSize = (next: { w?: number; h?: number }) =>
    applyRects("Resize", { [widget.id]: { ...rect, w: next.w ?? rect.w, h: next.h ?? rect.h } });

  const choose = (presetId: string, facing: Orientation) => {
    const preset = SIZE_PRESETS.find((one) => one.id === presetId);
    if (!preset) return;
    applyRects(`Make it ${preset.label}`, { [widget.id]: fitToPreset(rect, preset, facing, canvas) });
  };

  // A 4K screen shows a 1920-wide board at twice the pixels, so a picture
  // made for it is sharper at double.
  const fourK = canvas.width < 3840 ? Math.round(3840 / canvas.width) : 1;

  return (
    <div className="border-paper/15 mb-3 flex flex-col gap-3 border-b pb-3" data-dimensions>
      <span className={PANEL_LABEL}>Dimensions</span>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Width" value={w} onChange={(value) => setSize({ w: value })} min={8} max={canvas.width} />
        <NumberField label="Height" value={h} onChange={(value) => setSize({ h: value })} min={8} max={canvas.height} />
      </div>

      <p className="text-cell text-paper" role="status" data-size-preset>
        {matches.length > 0
          ? `${matches.map((one) => one.label).join(" or ")}${square ? "" : `, ${orientation}`}`
          : `Not a preset size — ${describeRatio(rect.w, rect.h)}`}
      </p>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Make it a preset size</span>
        <select
          className={PANEL_CONTROL}
          value={matches[0]?.id ?? ""}
          onChange={(event) => choose(event.target.value, orientation)}
        >
          <option value="" disabled>
            Choose a size
          </option>
          {GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {SIZE_PRESETS.filter((one) => one.group === group).map((one) => (
                <option key={one.id} value={one.id}>
                  {one.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {matches.length > 0 && !square && (
        <div className="flex gap-2">
          {(["portrait", "landscape"] as const).map((facing) => (
            <button
              key={facing}
              type="button"
              aria-pressed={orientation === facing}
              onClick={() => orientation !== facing && choose(matches[0].id, facing)}
              className={`${CHROME_BUTTON} flex-1 border ${
                orientation === facing ? `${CHROME_BUTTON_ON} border-transparent` : "border-paper/20"
              }`}
            >
              {facing === "portrait" ? "Portrait" : "Landscape"}
            </button>
          ))}
        </div>
      )}

      <p className={CHROME_META}>
        A picture made for it fits exactly at{" "}
        <span className="numeric text-paper whitespace-nowrap">
          {w} × {h} px
        </span>
        {fourK > 1 && (
          <>
            , or{" "}
            <span className="numeric text-paper whitespace-nowrap">
              {w * fourK} × {h * fourK} px
            </span>{" "}
            to stay sharp on a 4K screen
          </>
        )}
        . Drag a corner to resize it and keep the shape; drag an edge to change the shape.
      </p>
    </div>
  );
}
