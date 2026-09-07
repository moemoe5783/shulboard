"use client";

import { createElement, type CSSProperties, type HTMLAttributes } from "react";
import type { BoardDoc, BoardWidget } from "@/lib/board-doc";
import { boardRootStyle } from "@/lib/board-theme";
import { getManifest } from "@/widgets/manifests";
import { getRenderer } from "@/widgets/renderers";

/*
 * A board document, rendered. ONE OF THESE, FOR BOTH HALVES OF THE APP.
 *
 * CLAUDE.md: "The widget Renderer is shared by the editor and the display route.
 * Never fork it. If it renders differently in the two places, that's a bug."
 * plan.md §2 puts it the other way round: fork these and WYSIWYG dies.
 *
 * That rule is easy to state and easy to lose, because the editor genuinely
 * needs things the display does not — an id on every element, a lock attribute,
 * a cursor. So this component owns the board root and the positioning, and the
 * editor's extra needs arrive as `widgetProps`: attributes added to the element
 * this file positions. The editor cannot reposition anything, cannot restyle the
 * board, and cannot substitute a widget's renderer. It can only decorate.
 *
 * POSITIONING IS PERCENTAGES. Stored that way (CLAUDE.md), rendered that way,
 * and never converted to pixels here. Because the root is sized in real pixels
 * by whoever mounts it, a percentage-positioned child scales for free — that is
 * why zooming the editor is one number and why the same document fills a 4K wall
 * and a 720p television without a second code path.
 */

export type BoardRendererProps = {
  doc: BoardDoc;
  /** The design canvas, in design units. 1920×1080 unless the board says else. */
  canvas: { width: number; height: number };
  /**
   * Attributes the editor puts on each widget's positioned element — the id it
   * selects by, the lock flag, a cursor. The display passes nothing.
   *
   * A function, so only a client component can pass one. That is correct: only
   * the editor needs it, and the editor is a client component.
   */
  widgetProps?: (widget: BoardWidget) => HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
};

/** Widget types the document may contain that are not widgets. A group is a row
 *  carrying membership and a bounding box; it has no renderer and never will. */
const NON_RENDERING_TYPES = new Set(["group"]);

export function BoardRenderer({
  doc,
  canvas,
  widgetProps,
  className = "",
  style,
}: BoardRendererProps) {
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        // The container every board length is measured against. `cqw` resolves
        // to the nearest container ancestor, so this must be the only one
        // between the board root and a widget — otherwise a widget's type would
        // silently start scaling against the widget instead of the board.
        containerType: "size",
        ...boardRootStyle(doc),
        ...style,
      }}
    >
      {doc.widgets
        .filter((widget) => !widget.hidden && !NON_RENDERING_TYPES.has(widget.type))
        .map((widget) => (
          <WidgetFrame
            key={widget.id}
            widget={widget}
            canvas={canvas}
            extra={widgetProps?.(widget)}
          />
        ))}
    </div>
  );
}

/**
 * One widget's box, and whatever goes in it.
 *
 * The box is this file's job in both halves of the app. What goes in it is the
 * widget's own Renderer, which is the same component in both halves.
 */
function WidgetFrame({
  widget,
  canvas,
  extra,
}: {
  widget: BoardWidget;
  canvas: { width: number; height: number };
  extra?: HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
}) {
  const Renderer = getRenderer(widget.type);
  const { className: extraClassName = "", style: extraStyle, ...rest } = extra ?? {};

  return (
    <div
      {...rest}
      className={`absolute ${extraClassName}`}
      style={{
        left: `${widget.x}%`,
        top: `${widget.y}%`,
        width: `${widget.w}%`,
        height: `${widget.h}%`,
        transform: `rotate(${widget.rotation}deg)`,
        opacity: widget.opacity,
        zIndex: widget.z,
        ...extraStyle,
      }}
    >
      {/*
        createElement rather than <Renderer />, and not for style: the lint rule
        against components created during render cannot tell a lookup in a
        module-level map from a component defined inline, and flags the second
        while meaning the first. The identity here is stable for the life of the
        bundle — widgets/renderers.ts builds the map once — so the remounting the
        rule protects against cannot happen.
      */}
      {Renderer
        ? createElement(Renderer, { config: widget.config as never, canvas })
        : <UnknownWidget type={widget.type} />}
    </div>
  );
}

/**
 * A widget type this build does not have.
 *
 * Reachable in practice: a board saved by a newer deploy, or a widget withdrawn.
 * A screen in a lobby does not get to throw, and it does not get to show
 * nothing either — a silent gap looks like a board somebody built badly. It
 * says what it is, quietly, and the rest of the board carries on.
 */
function UnknownWidget({ type }: { type: string }) {
  const manifest = getManifest(type);

  // Says what happened and what to do, per design.md §5 — on a screen in a
  // lobby, reloading is the whole of what anybody can do about it, and it is
  // usually enough: the board came from a deploy this device has not picked up.
  return (
    <div className="border-current/25 flex h-full w-full items-center justify-center border border-dashed opacity-50">
      <span style={{ fontSize: "1.5cqw" }}>
        {manifest ? manifest.name : "This widget"} needs a newer version. Reload the screen.
      </span>
    </div>
  );
}
