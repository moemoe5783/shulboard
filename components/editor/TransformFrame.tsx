"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Moveable, {
  type OnDrag,
  type OnDragGroup,
  type OnDragGroupStart,
  type OnDragStart,
  type OnResize,
  type OnResizeGroup,
  type OnRotate,
  type OnRotateGroup,
} from "react-moveable";
import Selecto from "react-selecto";
import { useEditor } from "@/lib/editor/store";
import { widgetRect, type Rect } from "@/lib/editor/geometry";
import "./transform-frame.css";

/*
 * THE ONLY FILE IN THE PROJECT THAT IMPORTS react-moveable OR react-selecto.
 *
 * plan.md §4c decided both libraries and then decided this wrapper, for two
 * reasons that are still the reasons:
 *
 *   1. The modifier behaviour in §4b — Shift constrains an axis, Shift keeps a
 *      ratio, Alt duplicates, Ctrl/Cmd suspends snapping — has to be tuned in
 *      one place. Spread across the editor it becomes four subtly different
 *      answers to "what does Shift do here".
 *   2. If the library is outgrown, the swap is this file. Everything upstream
 *      talks in design-unit rectangles and widget ids.
 *
 * Nothing outside this file may import either library. That is the whole point.
 *
 * COORDINATES. The canvas is sized in real pixels — width = design width × zoom
 * — and every widget is positioned with percentages, so zooming is a change of
 * one number and the browser scales the contents for free. Deliberately NOT a
 * CSS `transform: scale()` on the canvas: react-moveable would then have to
 * unpick that matrix on every pointer move, its handles would shrink with the
 * zoom, and its snap threshold would mean a different distance at every zoom
 * level. With no ancestor transform, everything the library reports is a real
 * screen pixel, and design units are those divided by the zoom.
 */

export type TransformFrameProps = {
  /** The element that is exactly design-size × zoom. Widgets are its children. */
  canvasRef: React.RefObject<HTMLDivElement | null>;
  /** The scrolling viewport around the canvas. Decides which elements are close
   *  enough to be worth snapping against. */
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /** The same element as a selector, for Selecto to bound the marquee with.
   *  A selector rather than the node, because reading a ref during render is
   *  exactly the bug the rule against it exists to catch. */
  viewportSelector?: string;
  /** How to find a widget element. Each carries data-widget-id. */
  itemSelector?: string;
};

/** What a gesture needs to remember about one target, from the moment it began. */
type Frame = {
  /** Where the widget was when the gesture started, in design units. */
  start: Rect;
  /** Screen-pixel offset applied so far. */
  tx: number;
  ty: number;
  /** Screen-pixel size, which resizing changes and dragging does not. */
  widthPx: number;
  heightPx: number;
  rotate: number;
};

const SNAP_THRESHOLD_PX = 6;

export function TransformFrame({
  canvasRef,
  viewportRef,
  viewportSelector = "[data-editor-viewport]",
  itemSelector = "[data-widget-id]",
}: TransformFrameProps) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const zoom = useEditor((s) => s.zoom);
  const canvas = useEditor((s) => s.canvas);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const gridSize = useEditor((s) => s.gridSize);
  const showGrid = useEditor((s) => s.showGrid);

  const selectWidgets = useEditor((s) => s.selectWidgets);
  const applyRects = useEditor((s) => s.applyRects);
  const applyRotation = useEditor((s) => s.applyRotation);
  const duplicateInPlaceAndMove = useEditor((s) => s.duplicateInPlaceAndMove);

  const moveableRef = useRef<Moveable>(null);
  const selectoRef = useRef<Selecto>(null);
  const framesRef = useRef(new Map<string, Frame>());
  const altDragRef = useRef(false);
  const pointerDownRef = useRef(false);

  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const [guidelines, setGuidelines] = useState<HTMLElement[]>([]);
  const [modifiers, setModifiers] = useState({ shift: false, meta: false });

  const widgetsById = useMemo(
    () => new Map(doc.widgets.map((widget) => [widget.id, widget])),
    [doc.widgets],
  );

  /*
   * Modifier keys, read once for the whole transform layer.
   *
   * Moveable takes keepRatio and snappable as props rather than reading the
   * event, so the state has to exist somewhere; here is the one place it does.
   * Ctrl and Cmd both suspend snapping — §4b calls it "ctrl to stop clicking",
   * and on a Mac the finger that reaches for it lands on Cmd.
   */
  useEffect(() => {
    const read = (event: KeyboardEvent | MouseEvent) =>
      setModifiers((current) => {
        const shift = event.shiftKey;
        const meta = event.ctrlKey || event.metaKey;
        return current.shift === shift && current.meta === meta ? current : { shift, meta };
      });

    const clear = () => setModifiers({ shift: false, meta: false });

    window.addEventListener("keydown", read);
    window.addEventListener("keyup", read);
    window.addEventListener("mousemove", read);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", read);
      window.removeEventListener("keyup", read);
      window.removeEventListener("mousemove", read);
      window.removeEventListener("blur", clear);
    };
  }, []);

  /*
   * Is a button still down?
   *
   * Selecto hands a press that turns into a drag over to Moveable, and the
   * handover goes through a promise. On a quick click the pointer is already up
   * by the time it resolves, and Moveable then starts a drag with nothing to end
   * it: the widget attaches itself to the cursor and lands wherever the next
   * click happens to be. Rare enough by hand to look like a haunting, and
   * reproducible every time with a synthetic click.
   */
  useEffect(() => {
    const down = () => (pointerDownRef.current = true);
    const up = () => (pointerDownRef.current = false);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);

  /** The DOM nodes behind the selected ids. */
  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    const found = selection
      .map((id) => canvasEl.querySelector<HTMLElement>(`[data-widget-id="${id}"]`))
      .filter((el): el is HTMLElement => el !== null);

    setTargets((current) =>
      current.length === found.length && current.every((el, i) => el === found[i]) ? current : found,
    );
  }, [selection, doc.widgets, canvasRef]);

  /*
   * Snap targets, recomputed on a frame rather than on every change.
   *
   * plan.md §4c names this as a known cost: "snap-guide performance with 30+
   * elements on the canvas (throttle guide recalculation, and only compute
   * guides against elements in the viewport)". Both halves are here — the rAF
   * collapses a burst of changes into one pass, and anything scrolled out of
   * sight is skipped, because a guide you cannot see is a comparison you did not
   * need to make. Five divs would never show the problem; this is written so
   * thirty would not either.
   */
  const scheduled = useRef(0);
  const recomputeGuidelines = useCallback(() => {
    cancelAnimationFrame(scheduled.current);
    scheduled.current = requestAnimationFrame(() => {
      const canvasEl = canvasRef.current;
      const viewportEl = viewportRef.current;
      if (!canvasEl || !viewportEl) return;

      const view = viewportEl.getBoundingClientRect();
      const selected = new Set(selection);
      const visible: HTMLElement[] = [];

      for (const el of canvasEl.querySelectorAll<HTMLElement>(itemSelector)) {
        const id = el.dataset.widgetId;
        if (!id || selected.has(id)) continue;

        const rect = el.getBoundingClientRect();
        const offscreen =
          rect.bottom < view.top ||
          rect.top > view.bottom ||
          rect.right < view.left ||
          rect.left > view.right;
        if (offscreen) continue;

        visible.push(el);
      }

      setGuidelines((current) =>
        current.length === visible.length && current.every((el, i) => el === visible[i])
          ? current
          : visible,
      );
    });
  }, [canvasRef, viewportRef, selection, itemSelector]);

  useEffect(() => {
    recomputeGuidelines();
    return () => cancelAnimationFrame(scheduled.current);
  }, [recomputeGuidelines, doc.widgets, zoom]);

  useEffect(() => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) return;
    viewportEl.addEventListener("scroll", recomputeGuidelines, { passive: true });
    return () => viewportEl.removeEventListener("scroll", recomputeGuidelines);
  }, [viewportRef, recomputeGuidelines]);

  /** The canvas's own centre and edges, in pixels within the canvas. */
  const canvasGuides = useMemo(
    () => ({
      vertical: [0, (canvas.width * zoom) / 2, canvas.width * zoom],
      horizontal: [0, (canvas.height * zoom) / 2, canvas.height * zoom],
    }),
    [canvas.width, canvas.height, zoom],
  );

  // ---- gesture bookkeeping ------------------------------------------------

  const beginGesture = useCallback(
    (elements: HTMLElement[], alt: boolean) => {
      altDragRef.current = alt;
      framesRef.current.clear();

      for (const el of elements) {
        const id = el.dataset.widgetId;
        const widget = id ? widgetsById.get(id) : undefined;
        if (!id || !widget) continue;

        const start = widgetRect(widget, canvas);
        framesRef.current.set(id, {
          start,
          tx: 0,
          ty: 0,
          widthPx: start.w * zoom,
          heightPx: start.h * zoom,
          rotate: widget.rotation,
        });
      }
    },
    [widgetsById, canvas, zoom],
  );

  const paint = useCallback((el: HTMLElement) => {
    const id = el.dataset.widgetId;
    const frame = id ? framesRef.current.get(id) : undefined;
    if (!frame) return;

    el.style.transform = `translate(${frame.tx}px, ${frame.ty}px) rotate(${frame.rotate}deg)`;
    el.style.width = `${frame.widthPx}px`;
    el.style.height = `${frame.heightPx}px`;
  }, []);

  /*
   * Put a snapped edge exactly on the edge it snapped to.
   *
   * MEASURED: after a snap at fit zoom, the library leaves the element a quarter
   * of a screen pixel off the guide — 0.36 design units on a 1920 canvas. That
   * is invisible while you are dragging, at any zoom, because it is always about
   * a quarter of a pixel of whatever you are looking at. It stops being
   * invisible the moment somebody zooms in afterwards, or reads the stored
   * numbers and finds two "aligned" widgets that do not share a coordinate.
   *
   * So the committed value is pulled onto the guide it clearly meant. The
   * tolerance is 0.6 screen pixels' worth of design units — an order of
   * magnitude below the 6px snap threshold, so this can only ever finish a snap
   * the library already made, never invent one it did not.
   */
  const settleToGuides = useCallback(
    (rects: Record<string, Rect>) => {
      const tolerance = 0.6 / zoom;
      const moving = new Set(Object.keys(rects));

      const xGuides = [0, canvas.width / 2, canvas.width];
      const yGuides = [0, canvas.height / 2, canvas.height];

      for (const widget of doc.widgets) {
        if (moving.has(widget.id) || widget.hidden) continue;
        const rect = widgetRect(widget, canvas);
        xGuides.push(rect.x, rect.x + rect.w / 2, rect.x + rect.w);
        yGuides.push(rect.y, rect.y + rect.h / 2, rect.y + rect.h);
      }

      const gridStep = showGrid ? gridSize : 0;

      for (const rect of Object.values(rects)) {
        rect.x += bestCorrection([rect.x, rect.x + rect.w / 2, rect.x + rect.w], xGuides, gridStep, tolerance);
        rect.y += bestCorrection([rect.y, rect.y + rect.h / 2, rect.y + rect.h], yGuides, gridStep, tolerance);
      }
    },
    [zoom, canvas, doc.widgets, showGrid, gridSize],
  );

  /**
   * Hand the gesture's result to the store, then let React own the elements
   * again.
   *
   * The inline styles are cleared a frame later, not immediately: the committed
   * percentages and the inline pixels describe the same place, so leaving the
   * pixels up for one more paint means the element never blinks through an
   * intermediate position.
   */
  const endGesture = useCallback(
    (elements: HTMLElement[], kind: "move" | "resize" | "rotate") => {
      const rects: Record<string, Rect> = {};
      const rotations: Record<string, number> = {};
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const byId = new Map(elements.map((el) => [el.dataset.widgetId ?? "", el]));

      for (const [id, frame] of framesRef.current) {
        rotations[id] = frame.rotate;

        /*
         * Where the element actually ended up, read back off the page.
         *
         * Not `start + translate`: that arithmetic is a quarter of a pixel out
         * after a snap, because the library rounds the translate it reports
         * while the element it drew sits exactly on the guide. A quarter pixel
         * is invisible and still wrong — a widget snapped to another widget's
         * edge must store the same number that widget stores, or "aligned"
         * quietly means "nearly aligned" at every zoom above 100%.
         *
         * Only when the element is unrotated. getBoundingClientRect on a
         * rotated element returns the box around the rotation, which is a
         * different rectangle entirely; there, the arithmetic is right.
         */
        const el = byId.get(id);
        if (el && canvasRect && frame.rotate === 0) {
          const rect = el.getBoundingClientRect();
          rects[id] = {
            x: (rect.left - canvasRect.left) / zoom,
            y: (rect.top - canvasRect.top) / zoom,
            w: rect.width / zoom,
            h: rect.height / zoom,
          };
          continue;
        }

        rects[id] = {
          x: frame.start.x + frame.tx / zoom,
          y: frame.start.y + frame.ty / zoom,
          w: frame.widthPx / zoom,
          h: frame.heightPx / zoom,
        };
      }

      if (snapEnabled && !modifiers.meta) settleToGuides(rects);

      /*
       * An axis that did not move must come back with the number it started
       * with, exactly.
       *
       * Shift+drag pins one axis, and a resize from a corner pins the two edges
       * that corner is not on. Reading the position back off the page is
       * accurate to a fraction of a pixel and the snap correction above is
       * accurate to its tolerance, and neither is the same as "unchanged" — so
       * a constrained drag would leave a hundredth of a unit of drift on the
       * axis the person explicitly held still.
       */
      for (const [id, frame] of framesRef.current) {
        if (frame.tx === 0) rects[id].x = frame.start.x;
        if (frame.ty === 0) rects[id].y = frame.start.y;
      }

      if (kind === "move" && altDragRef.current) {
        duplicateInPlaceAndMove(rects);
      } else if (kind === "rotate") {
        applyRotation("Rotate", rotations);
        applyRects("Rotate", rects);
      } else {
        applyRects(kind === "resize" ? "Resize" : "Move", rects);
      }

      altDragRef.current = false;

      // Not cleared — rewritten as the percentages that were just committed.
      // Clearing looks equivalent and is not: a drag leaves width and height
      // untouched, so React's diff finds nothing to update and never re-applies
      // them, and an element whose inline width is removed collapses to nothing.
      requestAnimationFrame(() => {
        for (const el of elements) {
          const id = el.dataset.widgetId;
          const rect = id ? rects[id] : undefined;
          if (!rect || !id) continue;

          el.style.transform = `rotate(${rotations[id]}deg)`;
          el.style.width = `${(rect.w / canvas.width) * 100}%`;
          el.style.height = `${(rect.h / canvas.height) * 100}%`;
        }
      });
    },
    [
      zoom,
      canvas.width,
      canvas.height,
      canvasRef,
      snapEnabled,
      modifiers.meta,
      settleToGuides,
      applyRects,
      applyRotation,
      duplicateInPlaceAndMove,
    ],
  );

  /** Shift during a drag pins the movement to whichever axis is winning. */
  const constrainAxis = useCallback(
    (tx: number, ty: number, shift: boolean): [number, number] =>
      !shift ? [tx, ty] : Math.abs(tx) >= Math.abs(ty) ? [tx, 0] : [0, ty],
    [],
  );

  const onDragOne = useCallback(
    ({ target, beforeTranslate, inputEvent }: OnDrag) => {
      const el = target as HTMLElement;
      const frame = framesRef.current.get(el.dataset.widgetId ?? "");
      if (!frame) return;

      const [tx, ty] = constrainAxis(
        beforeTranslate[0],
        beforeTranslate[1],
        Boolean(inputEvent?.shiftKey),
      );
      frame.tx = tx;
      frame.ty = ty;
      paint(el);
    },
    [constrainAxis, paint],
  );

  return (
    <>
      <Moveable
        ref={moveableRef}
        target={targets}
        origin={false}
        draggable
        resizable
        rotatable
        // Shift keeps the aspect ratio while resizing (§4b). It also constrains
        // the drag axis; the two never happen at once, so one key does both.
        keepRatio={modifiers.shift}
        renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
        rotationPosition="top"
        // Ctrl or Cmd held turns snapping off for as long as it is held.
        snappable={snapEnabled && !modifiers.meta}
        // The canvas, so the guideline numbers below are canvas pixels rather
        // than page pixels. Moveable takes a ref object here, which is how this
        // is passed without reading `.current` during render.
        snapContainer={canvasRef}
        snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
        elementSnapDirections={{
          top: true,
          left: true,
          bottom: true,
          right: true,
          center: true,
          middle: true,
        }}
        elementGuidelines={guidelines}
        verticalGuidelines={canvasGuides.vertical}
        horizontalGuidelines={canvasGuides.horizontal}
        // Grid snapping follows the Grid switch. A grid that is off but still
        // catching the drag is the editor arguing with what it is showing.
        snapGridWidth={showGrid ? gridSize * zoom : 0}
        snapGridHeight={showGrid ? gridSize * zoom : 0}
        snapThreshold={SNAP_THRESHOLD_PX}
        // Nothing is throttled to a step: the grid does that when it is on, and
        // rounding a drag when it is off just makes the widget feel sticky.
        throttleDrag={0}
        throttleResize={0}
        throttleRotate={0}
        onDragStart={({ target, inputEvent }: OnDragStart) =>
          beginGesture([target as HTMLElement], Boolean(inputEvent?.altKey))
        }
        onDrag={onDragOne}
        onDragEnd={({ target }) => endGesture([target as HTMLElement], "move")}
        onDragGroupStart={({ targets: group, inputEvent }: OnDragGroupStart) =>
          beginGesture(group as HTMLElement[], Boolean(inputEvent?.altKey))
        }
        onDragGroup={({ events }: OnDragGroup) => events.forEach(onDragOne)}
        onDragGroupEnd={({ targets: group }) => endGesture(group as HTMLElement[], "move")}
        onResizeStart={({ target }) => beginGesture([target as HTMLElement], false)}
        onResize={({ target, width, height, drag }: OnResize) => {
          const el = target as HTMLElement;
          const frame = framesRef.current.get(el.dataset.widgetId ?? "");
          if (!frame) return;
          frame.widthPx = width;
          frame.heightPx = height;
          frame.tx = drag.beforeTranslate[0];
          frame.ty = drag.beforeTranslate[1];
          paint(el);
        }}
        onResizeEnd={({ target }) => endGesture([target as HTMLElement], "resize")}
        onResizeGroupStart={({ targets: group }) => beginGesture(group as HTMLElement[], false)}
        onResizeGroup={({ events }: OnResizeGroup) =>
          events.forEach(({ target, width, height, drag }) => {
            const el = target as HTMLElement;
            const frame = framesRef.current.get(el.dataset.widgetId ?? "");
            if (!frame) return;
            frame.widthPx = width;
            frame.heightPx = height;
            frame.tx = drag.beforeTranslate[0];
            frame.ty = drag.beforeTranslate[1];
            paint(el);
          })
        }
        onResizeGroupEnd={({ targets: group }) => endGesture(group as HTMLElement[], "resize")}
        onRotateStart={({ target }) => beginGesture([target as HTMLElement], false)}
        onRotate={({ target, beforeRotate, drag }: OnRotate) => {
          const el = target as HTMLElement;
          const frame = framesRef.current.get(el.dataset.widgetId ?? "");
          if (!frame) return;
          frame.rotate = beforeRotate;
          frame.tx = drag.beforeTranslate[0];
          frame.ty = drag.beforeTranslate[1];
          paint(el);
        }}
        onRotateEnd={({ target }) => endGesture([target as HTMLElement], "rotate")}
        onRotateGroupStart={({ targets: group }) => beginGesture(group as HTMLElement[], false)}
        onRotateGroup={({ events }: OnRotateGroup) =>
          events.forEach(({ target, beforeRotate, drag }) => {
            const el = target as HTMLElement;
            const frame = framesRef.current.get(el.dataset.widgetId ?? "");
            if (!frame) return;
            frame.rotate = beforeRotate;
            frame.tx = drag.beforeTranslate[0];
            frame.ty = drag.beforeTranslate[1];
            paint(el);
          })
        }
        onRotateGroupEnd={({ targets: group }) => endGesture(group as HTMLElement[], "rotate")}
      />

      <Selecto
        ref={selectoRef}
        dragContainer={viewportSelector}
        // Locked widgets are not selectable at all, which is what lock means.
        selectableTargets={[`${itemSelector}:not([data-locked="true"])`]}
        hitRate={0}
        selectByClick
        selectFromInside={false}
        toggleContinueSelect={["shift"]}
        preventDefault
        onDragStart={(event) => {
          const target = event.inputEvent.target as HTMLElement;
          // A press that lands on a handle, or on something already selected, is
          // the start of a transform, not the start of a marquee.
          if (
            moveableRef.current?.isMoveableElement(target) ||
            targets.some((el) => el === target || el.contains(target))
          ) {
            event.stop();
          }
        }}
        onSelectEnd={(event) => {
          // The store expands a group selection, so a click here and a
          // right-click in the editor lab select the same thing. Having had two
          // copies of that logic is how they came to disagree.
          selectWidgets(
            event.selected
              .map((el) => (el as HTMLElement).dataset.widgetId)
              .filter((id): id is string => Boolean(id)),
          );

          // A click that becomes a drag hands straight over to Moveable, so
          // press-and-move on an unselected widget moves it in one gesture
          // instead of needing a click first.
          if (event.isDragStart) {
            event.inputEvent.preventDefault();
            moveableRef.current?.waitToChangeTarget().then(() => {
              // Only if the press is still a press. See the note above.
              if (!pointerDownRef.current) return;
              moveableRef.current?.dragStart(event.inputEvent);
            });
          }
        }}
      />
    </>
  );
}

/**
 * The smallest shift that puts one of an element's three anchors exactly on a
 * guide. Zero if nothing is within tolerance.
 */
function bestCorrection(
  anchors: number[],
  guides: number[],
  gridStep: number,
  tolerance: number,
): number {
  let best = 0;
  let bestDistance = tolerance;

  const consider = (from: number, to: number) => {
    const distance = Math.abs(to - from);
    if (distance > 0 && distance <= bestDistance) {
      bestDistance = distance;
      best = to - from;
    }
  };

  for (const anchor of anchors) {
    for (const guide of guides) consider(anchor, guide);
    if (gridStep > 0) consider(anchor, Math.round(anchor / gridStep) * gridStep);
  }

  return best;
}
