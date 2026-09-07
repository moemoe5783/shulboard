"use client";

import { useEditor } from "@/lib/editor/store";
import {
  CHROME_BUTTON,
  CHROME_BUTTON_ON,
  CHROME_DARK,
  CHROME_META,
  CHROME_RULE,
} from "./chrome";
import { AddWidgetMenu } from "./AddWidgetMenu";
import { useCommands } from "./commands";

/*
 * The editor's one bar. Zoom, the snapping switches, history, and the align and
 * distribute set §4b asks for on a multi-selection.
 *
 * It reads the same command list the right-click menu does, so the two cannot
 * disagree about what is available.
 *
 * No verdigris fill anywhere in this view. A fill is what a primary action
 * wears; the switches here are states, so they take the active-nav treatment —
 * --verdigris-wash behind --verdigris text — and the accent keeps one meaning.
 */

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];

export function Toolbar({
  onFit,
  canvas,
}: {
  onFit: () => void;
  canvas: { width: number; height: number };
}) {
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const setSnapEnabled = useEditor((s) => s.setSnapEnabled);
  const showGrid = useEditor((s) => s.showGrid);
  const setShowGrid = useEditor((s) => s.setShowGrid);
  const gridSize = useEditor((s) => s.gridSize);
  const setGridSize = useEditor((s) => s.setGridSize);
  const selection = useEditor((s) => s.selection);

  const groups = useCommands();
  const byId = new Map(groups.flatMap((group) => group.commands).map((c) => [c.id, c]));
  const run = (id: string) => byId.get(id);

  const stepZoom = (direction: 1 | -1) => {
    const index = ZOOM_STEPS.findIndex((step) => step > zoom + 0.001);
    const next =
      direction === 1
        ? (ZOOM_STEPS[index] ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
        : (ZOOM_STEPS[(index === -1 ? ZOOM_STEPS.length : index) - 2] ?? ZOOM_STEPS[0]);
    setZoom(next);
  };

  return (
    <div
      {...CHROME_DARK}
      className={`font-ui flex h-10 shrink-0 items-center gap-1 border-b px-2 ${CHROME_RULE}`}
    >
      <AddWidgetMenu canvas={canvas} />

      <Divider />

      <Command id="undo" run={run} label="Undo" />
      <Command id="redo" run={run} label="Redo" />

      <Divider />

      <button type="button" className={CHROME_BUTTON} onClick={() => stepZoom(-1)} aria-label="Zoom out">
        &minus;
      </button>
      {/* A percentage that changes as you zoom, so it is a figure that wants to
          hold still. The numeric utility is a no-op on this face today and
          correct the day the face changes — design.md §3. */}
      <span className={`${CHROME_META} numeric w-12 text-center`}>{Math.round(zoom * 100)}%</span>
      <button type="button" className={CHROME_BUTTON} onClick={() => stepZoom(1)} aria-label="Zoom in">
        +
      </button>
      <button type="button" className={CHROME_BUTTON} onClick={onFit}>
        Fit
      </button>

      <Divider />

      <button
        type="button"
        aria-pressed={snapEnabled}
        onClick={() => setSnapEnabled(!snapEnabled)}
        className={`${CHROME_BUTTON} ${snapEnabled ? CHROME_BUTTON_ON : ""}`}
      >
        Snap
      </button>
      <button
        type="button"
        aria-pressed={showGrid}
        onClick={() => setShowGrid(!showGrid)}
        className={`${CHROME_BUTTON} ${showGrid ? CHROME_BUTTON_ON : ""}`}
      >
        Grid
      </button>
      <label className={`${CHROME_META} flex items-center gap-1`}>
        <span className="sr-only">Grid size in design units</span>
        <input
          type="number"
          min={2}
          max={200}
          step={2}
          value={gridSize}
          onChange={(event) => setGridSize(Number(event.target.value))}
          className={`text-cell rounded-control text-paper numeric h-8 w-14 border bg-transparent px-1 ${CHROME_RULE}`}
        />
      </label>

      <Divider />

      <Command id="align-left" run={run} label="Left" />
      <Command id="align-hcenter" run={run} label="Centres" />
      <Command id="align-right" run={run} label="Right" />
      <Command id="align-top" run={run} label="Top" />
      <Command id="align-vcenter" run={run} label="Middles" />
      <Command id="align-bottom" run={run} label="Bottom" />
      <Command id="distribute-h" run={run} label="Space across" />
      <Command id="distribute-v" run={run} label="Space down" />

      <Divider />

      <Command id="group" run={run} label="Group" />
      <Command id="ungroup" run={run} label="Ungroup" />

      <span className={`${CHROME_META} numeric ml-auto pr-1`}>
        {selection.length === 0
          ? "Nothing selected"
          : `${selection.length} selected`}
      </span>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className={`mx-1 h-5 w-px shrink-0 border-l ${CHROME_RULE}`} />;
}

function Command({
  id,
  label,
  run,
}: {
  id: string;
  label: string;
  run: (id: string) => { enabled: boolean; run: () => void } | undefined;
}) {
  const command = run(id);
  return (
    <button
      type="button"
      className={CHROME_BUTTON}
      disabled={!command?.enabled}
      onClick={() => command?.run()}
    >
      {label}
    </button>
  );
}
