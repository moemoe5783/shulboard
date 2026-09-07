import type { BoardWidget } from "@/lib/board-doc";

/*
 * The one place pixels become percentages and back.
 *
 * plan.md §4a: positions are stored as percentages of the design canvas and
 * rendered as pixels, so a board scales to any real screen. CLAUDE.md makes that
 * a hard rule, and parseBoardDoc enforces it on write — this file is what keeps
 * the editor honest in between.
 *
 * The editor works in DESIGN UNITS, not screen pixels: a 1920×1080 board is 1920
 * design units wide however far it is zoomed out, so the numbers a person reads
 * and nudges stay meaningful. Screen pixels appear only where the browser hands
 * them over, and are divided by the zoom on the way in.
 */

export type CanvasSize = { width: number; height: number };

/** A rectangle in design units. */
export type Rect = { x: number; y: number; w: number; h: number };

export const toPercentX = (designX: number, canvas: CanvasSize) =>
  (designX / canvas.width) * 100;
export const toPercentY = (designY: number, canvas: CanvasSize) =>
  (designY / canvas.height) * 100;
export const toDesignX = (percentX: number, canvas: CanvasSize) =>
  (percentX / 100) * canvas.width;
export const toDesignY = (percentY: number, canvas: CanvasSize) =>
  (percentY / 100) * canvas.height;

/** A widget's stored percentages as a design-unit rectangle. */
export function widgetRect(widget: BoardWidget, canvas: CanvasSize): Rect {
  return {
    x: toDesignX(widget.x, canvas),
    y: toDesignY(widget.y, canvas),
    w: toDesignX(widget.w, canvas),
    h: toDesignY(widget.h, canvas),
  };
}

/** The inverse. Rounded to 4 decimals: enough for sub-pixel accuracy on an 8K
 *  canvas, and it keeps the stored document from filling with float noise. */
export function rectToWidget(rect: Rect, canvas: CanvasSize) {
  return {
    x: round(toPercentX(rect.x, canvas)),
    y: round(toPercentY(rect.y, canvas)),
    w: round(toPercentX(rect.w, canvas)),
    h: round(toPercentY(rect.h, canvas)),
  };
}

export const round = (n: number) => Math.round(n * 10000) / 10000;

/** The box that contains every rect. Undefined for an empty list. */
export function boundingRect(rects: Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }

  return { x: left, y: top, w: right - left, h: bottom - top };
}

/*
 * Align and distribute, for a multi-selection.
 *
 * Both work on the selection's own bounding box rather than the canvas. Aligning
 * three widgets left means "line them up with the leftmost of the three", which
 * is what every editor does and what people expect; aligning to the canvas is a
 * different command and is not one §4b asks for.
 */

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export function alignRects(rects: Rect[], edge: AlignEdge): Rect[] {
  const bounds = boundingRect(rects);
  if (!bounds) return rects;

  return rects.map((rect) => {
    switch (edge) {
      case "left":
        return { ...rect, x: bounds.x };
      case "hcenter":
        return { ...rect, x: bounds.x + (bounds.w - rect.w) / 2 };
      case "right":
        return { ...rect, x: bounds.x + bounds.w - rect.w };
      case "top":
        return { ...rect, y: bounds.y };
      case "vcenter":
        return { ...rect, y: bounds.y + (bounds.h - rect.h) / 2 };
      case "bottom":
        return { ...rect, y: bounds.y + bounds.h - rect.h };
    }
  });
}

/**
 * Even gaps between the outer two, which stay put.
 *
 * Distributing by gap rather than by centre is the version that looks right when
 * the widgets are different sizes, and different sizes is the normal case on a
 * board.
 */
export function distributeRects(rects: Rect[], axis: "horizontal" | "vertical"): Rect[] {
  if (rects.length < 3) return rects;

  const horizontal = axis === "horizontal";
  const start = (r: Rect) => (horizontal ? r.x : r.y);
  const extent = (r: Rect) => (horizontal ? r.w : r.h);

  const order = rects.map((rect, index) => ({ rect, index })).sort((a, b) => start(a.rect) - start(b.rect));

  const first = order[0].rect;
  const last = order[order.length - 1].rect;
  const span = start(last) + extent(last) - start(first);
  const occupied = order.reduce((total, { rect }) => total + extent(rect), 0);
  const gap = (span - occupied) / (order.length - 1);

  const out = rects.slice();
  let cursor = start(first);

  for (const { rect, index } of order) {
    out[index] = horizontal ? { ...rect, x: cursor } : { ...rect, y: cursor };
    cursor += extent(rect) + gap;
  }

  return out;
}
