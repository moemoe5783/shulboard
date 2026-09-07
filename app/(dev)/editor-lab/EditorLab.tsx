"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BoardRenderer } from "@/components/board/BoardRenderer";
import { TransformFrame } from "@/components/editor/TransformFrame";
import { DEMO_CANVAS, demoBoardDoc } from "@/lib/demo-board";
import { GROUP_TYPE, useEditor } from "@/lib/editor/store";
import { tickListenerCount, useSecond } from "@/lib/tick";
import { ContextMenu, type MenuPosition } from "./ContextMenu";
import { LayersPanel } from "./LayersPanel";
import { Toolbar } from "./Toolbar";
import { CHROME_DARK, CHROME_SURFACE } from "./chrome";

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

const CANVAS = DEMO_CANVAS;
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
  /*
   * The lab seeds from the same document /s/[token] serves.
   *
   * That is the check, not a convenience: if the editor and the display ever
   * render it differently, the difference is visible by opening two tabs, and
   * the shared-renderer rule stops being a claim in a comment.
   *
   * On mount rather than during render — the display route renders this on the
   * server, and a document built during render would have to agree with it.
   */
  useEffect(() => {
    useEditor.getState().load(demoBoardDoc());
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
      <Toolbar onFit={fit} canvas={CANVAS} />

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

            /*
             * A right-click selects what it lands on, the way every editor
             * does — and the way this one did not.
             *
             * Without it the menu opened on whatever happened to be selected
             * already, which for a first right-click is nothing, so every
             * command in it was disabled and the menu was decorative. Landing
             * on empty canvas clears, which is what makes Paste the sensible
             * thing to reach for there.
             */
            /*
             * The whole stack under the pointer, not event.target.
             *
             * A selected widget is covered by the transform layer's own
             * overlay, which carries no widget id — so reading event.target
             * meant that right-clicking the one thing you had just selected
             * looked like right-clicking bare canvas, and cleared the
             * selection out from under the menu. elementsFromPoint sees past
             * whatever is floating on top without this file having to know
             * what that is, which keeps the library behind TransformFrame
             * where §4c put it.
             */
            const id = document
              .elementsFromPoint(event.clientX, event.clientY)
              .find((el): el is HTMLElement => el instanceof HTMLElement && "widgetId" in el.dataset)
              ?.dataset.widgetId;
            const store = useEditor.getState();

            if (!id) store.clearSelection();
            else if (!store.selection.includes(id)) store.selectWidgets([id]);

            setMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <div className="w-max p-8">
            <div ref={canvasRef} style={{ width: canvasPx.width, height: canvasPx.height }}>
              {showGrid && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-20"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, var(--rule) 1px, transparent 1px)," +
                      "linear-gradient(to bottom, var(--rule) 1px, transparent 1px)",
                    backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
                  }}
                />
              )}

              {/*
                THE SAME COMPONENT THE DISPLAY ROUTE USES. The editor does not
                position widgets, style the board, or choose a renderer — it
                hands BoardRenderer a set of attributes to put on each widget's
                box and nothing more. There is no editor-side copy of any of
                this to drift.
              */}
              <BoardRenderer
                doc={doc}
                canvas={CANVAS}
                className="h-full w-full"
                widgetProps={(widget) => ({
                  "data-widget-id": widget.id,
                  "data-locked": widget.locked ? "true" : undefined,
                  // Live content inside a widget would otherwise eat the
                  // gesture: an <img> starts a native drag, text takes a
                  // selection. The box still receives the press, so Selecto and
                  // Moveable work; only its contents stop listening. This is an
                  // editor concern and it stays outside the renderer.
                  className: `select-none [&_*]:pointer-events-none ${
                    widget.locked ? "cursor-not-allowed" : "cursor-move"
                  }`,
                })}
              />
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

  /*
   * The tick's subscriber count, which is the whole of plan.md §3e made
   * visible.
   *
   * Subscribing here is what makes it readable — the row re-renders on the same
   * tick the clocks do, so the number is current rather than whatever it was
   * when the board last changed. That costs one subscriber, which is why the
   * label says so.
   *
   * The number to watch is not how high it goes but whether it comes back down.
   * A count that climbs as widgets are added and deleted is the leak that kills
   * a display route left running for a month.
   */
  useSecond();
  const subscribers = tickListenerCount();

  return (
    <div
      {...CHROME_DARK}
      className="font-ui border-paper/15 text-meta text-paper/60 numeric flex h-8 shrink-0 items-center gap-4 border-t px-3"
    >
      {/* "element(s)" — docs/sizing.md §6. "widget" stays the word in code. */}
      <span>
        {count} {count === 1 ? "element" : "elements"}
      </span>
      <span>{selected} selected</span>
      <span>
        {history.past.length} undo, {history.future.length} redo
      </span>
      <span data-tick-subscribers={subscribers}>
        {subscribers} on the tick, this row included
      </span>
      <span className="ml-auto">
        Hold ctrl or cmd to suspend snapping. Alt-drag to duplicate. Shift to
        constrain.
      </span>
    </div>
  );
}
