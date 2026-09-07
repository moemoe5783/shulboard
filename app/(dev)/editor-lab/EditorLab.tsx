"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { boardWidgetSchema, type BoardWidget } from "@/lib/board-doc";
import { TransformFrame } from "@/components/editor/TransformFrame";
import { GROUP_TYPE, useEditor } from "@/lib/editor/store";
import { rectToWidget } from "@/lib/editor/geometry";
import { ContextMenu, type MenuPosition } from "./ContextMenu";
import { LayersPanel, TONE_FILL, TONES, labelOf, toneOf } from "./LayersPanel";
import { Toolbar } from "./Toolbar";
import { CHROME_SURFACE } from "./chrome";

/*
 * The transform layer, on its own, with nothing else to blame.
 *
 * plan.md §11: "The interaction spec in §4b is the prompt for P1 — ask for it as
 * a standalone demo page with a few coloured divs before any real widgets
 * exist." That is what this is. No database, no auth, no widgets, no saving:
 * only whether dragging, resizing, snapping and undo feel right, which §9 calls
 * the highest-risk thing in the build.
 *
 * The document it edits is a real board document. Positions are percentages and
 * go through the same boardWidgetSchema the editor's autosave will, so a
 * coordinate bug shows up here rather than on a lobby wall.
 *
 * NOTE ON TYPE. The chrome opts into Assistant with `font-ui`; the canvas
 * deliberately does not, and neither will the real one. Board fonts come from
 * the board document and are user-selectable per element, so chrome type must
 * never reach the renderer by inheritance.
 */

/** Five boxes, in design units on a 1920×1080 canvas. */
const SEED = [
  { label: "Zmanim", tone: "ink", x: 120, y: 120, w: 520, h: 360 },
  { label: "Notices", tone: "verdigris", x: 720, y: 120, w: 700, h: 220 },
  { label: "Clock", tone: "ink-soft", x: 1500, y: 120, w: 300, h: 300 },
  { label: "Photo", tone: "ink-faint", x: 720, y: 420, w: 400, h: 480 },
  { label: "Parsha", tone: "verdigris-wash", x: 1200, y: 520, w: 600, h: 300 },
] as const;

const CANVAS = { width: 1920, height: 1080 };
const NUDGE_SMALL = 1;
const NUDGE_LARGE = 10;

export function EditorLab() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const doc = useEditor((s) => s.doc);
  const zoom = useEditor((s) => s.zoom);
  const showGrid = useEditor((s) => s.showGrid);
  const gridSize = useEditor((s) => s.gridSize);
  const selection = useEditor((s) => s.selection);
  const setZoom = useEditor((s) => s.setZoom);

  // Readiness is the store's, not React's: an effect may write to an external
  // store, and this way the transform layer and the canvas agree on one fact.
  const ready = useEditor((s) => s.loaded);
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  /*
   * Seeding happens on the client, after mount.
   *
   * Widget ids are UUIDs, so a document built during render would differ between
   * the server's markup and the browser's first pass and React would report a
   * hydration mismatch. Nothing on this page is worth server-rendering anyway.
   */
  useEffect(() => {
    const widgets: BoardWidget[] = SEED.map((box, index) =>
      boardWidgetSchema.parse({
        id: crypto.randomUUID(),
        type: "placeholder",
        ...rectToWidget({ x: box.x, y: box.y, w: box.w, h: box.h }, CANVAS),
        z: index,
        config: { label: box.label, tone: box.tone },
      }),
    );

    useEditor.getState().load({ schemaVersion: 1, widgets });
  }, []);

  /** Zoom to fit, which is where the editor opens (§4a). */
  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const padding = 64;
    setZoom(
      Math.min(
        (viewport.clientWidth - padding) / CANVAS.width,
        (viewport.clientHeight - padding) / CANVAS.height,
      ),
    );
  }, [setZoom]);

  useEffect(() => {
    if (!ready) return;
    fit();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
    // Only on first ready: re-fitting after every zoom change would fight the
    // zoom control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const addBox = useCallback(() => {
    const store = useEditor.getState();
    const widget = boardWidgetSchema.parse({
      id: crypto.randomUUID(),
      type: "placeholder",
      ...rectToWidget({ x: 760, y: 400, w: 400, h: 280 }, CANVAS),
      z: store.doc.widgets.length,
      config: {
        label: "Box",
        tone: TONES[store.doc.widgets.length % TONES.length],
      },
    });

    // Through the store's command path, so adding a box is undoable like
    // everything else. load() would have cleared the history instead.
    store.addWidgets([widget], "Add box");
  }, []);

  /*
   * Keyboard — §4b.
   *
   * On window rather than on the canvas: the canvas is not focusable, and making
   * it so would put a focus ring around the board. Typing into a field is the
   * one case that has to be excluded, and the number input in the toolbar is
   * exactly that case.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const store = useEditor.getState();
      const mod = event.metaKey || event.ctrlKey;
      const step = event.shiftKey ? NUDGE_LARGE : NUDGE_SMALL;

      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };

      if (arrows[event.key] && store.selection.length > 0) {
        event.preventDefault();
        store.nudge(...arrows[event.key]);
        return;
      }

      if (event.key === "Escape") return store.clearSelection();
      if (event.key === "Delete" || event.key === "Backspace") {
        if (store.selection.length === 0) return;
        event.preventDefault();
        return store.remove();
      }

      if (!mod) return;

      switch (event.key.toLowerCase()) {
        case "z":
          event.preventDefault();
          return event.shiftKey ? store.redo() : store.undo();
        case "y":
          event.preventDefault();
          return store.redo();
        case "c":
          return store.copy();
        case "x":
          return store.cut();
        case "v":
          return store.paste();
        case "d":
          event.preventDefault();
          store.duplicate();
          return;
        case "a":
          event.preventDefault();
          return store.selectAll();
        case "g":
          event.preventDefault();
          return event.shiftKey ? store.ungroup() : store.group();
      }

      // The bracket shortcuts read the physical key, not the character: with
      // Shift held the browser reports "}" and "{", so matching on event.key
      // would break the bring-to-front and send-to-back half of §4b's z-order.
      if (event.code === "BracketRight") {
        event.preventDefault();
        return event.shiftKey ? store.bringToFront() : store.bringForward();
      }
      if (event.code === "BracketLeft") {
        event.preventDefault();
        return event.shiftKey ? store.sendToBack() : store.sendBackward();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const canvasPx = { width: CANVAS.width * zoom, height: CANVAS.height * zoom };

  return (
    <div className={`flex h-screen flex-col ${CHROME_SURFACE}`}>
      <Toolbar onFit={fit} onAddBox={addBox} />

      <div className="flex min-h-0 flex-1">
        <LayersPanel />

        {/* The canvas sits on --ink at 88%, which is design.md §4's one
            deliberate use of a dark ground: it makes the board the brightest
            object on the screen. */}
        <div
          ref={viewportRef}
          data-editor-viewport
          className="bg-ink/88 relative min-w-0 flex-1 overflow-auto"
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <div className="w-max p-8">
            <div
              ref={canvasRef}
              className="bg-surface relative"
              style={{ width: canvasPx.width, height: canvasPx.height }}
            >
              {showGrid && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, var(--rule) 1px, transparent 1px)," +
                      "linear-gradient(to bottom, var(--rule) 1px, transparent 1px)",
                    backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
                  }}
                />
              )}

              {doc.widgets
                .filter((widget) => widget.type !== GROUP_TYPE && !widget.hidden)
                .map((widget) => (
                  <div
                    key={widget.id}
                    data-widget-id={widget.id}
                    data-locked={widget.locked ? "true" : undefined}
                    className={`absolute flex items-start justify-start ${TONE_FILL[toneOf(widget.config)]} ${
                      widget.locked ? "cursor-not-allowed" : "cursor-move"
                    }`}
                    style={{
                      left: `${widget.x}%`,
                      top: `${widget.y}%`,
                      width: `${widget.w}%`,
                      height: `${widget.h}%`,
                      transform: `rotate(${widget.rotation}deg)`,
                      opacity: widget.opacity,
                      zIndex: widget.z,
                    }}
                  >
                    {/* Sized against the canvas so the label scales with the
                        zoom, the way real widget type will. */}
                    <span
                      className="leading-none"
                      style={{ padding: 8 * zoom, fontSize: 18 * zoom }}
                    >
                      {labelOf(widget.config, widget.id)}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {ready && <TransformFrame canvasRef={canvasRef} viewportRef={viewportRef} />}
        </div>
      </div>

      <StatusBar count={doc.widgets.filter((w) => w.type !== GROUP_TYPE).length} selected={selection.length} />

      <ContextMenu at={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

function StatusBar({ count, selected }: { count: number; selected: number }) {
  const history = useEditor((s) => s.history);

  return (
    <div className="font-ui border-paper/15 text-meta text-paper/60 numeric flex h-8 shrink-0 items-center gap-4 border-t px-3">
      <span>
        {count} {count === 1 ? "box" : "boxes"}
      </span>
      <span>{selected} selected</span>
      <span>
        {history.past.length} undo, {history.future.length} redo
      </span>
      <span className="ml-auto">
        Hold ctrl or cmd to suspend snapping. Alt-drag to duplicate. Shift to
        constrain.
      </span>
    </div>
  );
}
