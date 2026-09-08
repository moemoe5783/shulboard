"use client";

import { createElement, useEffect, useRef, type CSSProperties, type HTMLAttributes } from "react";
import type { BoardDoc, BoardWidget } from "@/lib/board-doc";
import { boardRootStyle } from "@/lib/board-theme";
import { getManifest } from "@/widgets/manifests";
import { getRenderer } from "@/widgets/renderers";
import type { SizingMode } from "@/widgets/types";

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
  const frameRef = useRef<HTMLDivElement>(null);

  /*
   * docs/sizing.md §2, the `hug` mode: the box resizes to fit the content at
   * the declared type size, height only — width keeps its usual job as a wrap
   * boundary, the same role it has in `fixed`. Read generically off the
   * widget's own config rather than through WidgetManifest, because this file
   * has no per-widget config type to narrow to; every widget that offers
   * `hug`/`fixed` names this field `sizingMode`, the same convention
   * clock/manifest.ts already established.
   *
   * `height: "auto"` is the entire mechanism. An absolutely positioned box
   * with a declared `top` sizes to its content's natural height and the top
   * edge doesn't move — docs/sizing.md §3's "grows away from its alignment
   * edge" for the top case, for free, because that's just how CSS lays out an
   * auto-height absolute box. No ResizeObserver, no measurement loop, and
   * `overflow: hidden` below stays harmless: content can never exceed a box
   * sized to exactly contain it. This is what makes overflow structurally
   * impossible in this mode rather than something to warn about.
   */
  const sizingMode = (widget.config as { sizingMode?: SizingMode }).sizingMode;

  /*
   * docs/sizing.md §3: "the renderer must not resize or reposition the box to
   * fit content... never grow the box." `overflow: hidden` below is what makes
   * that true regardless of what any widget's own Renderer does inside it —
   * one place, for every widget present and future, rather than a rule every
   * widget folder has to remember.
   *
   * `data-overflowing` is the editor's warning (docs/sizing.md §3, "flag in
   * the properties panel"), read externally by
   * components/editor/useElementOverflow.ts — plain DOM state, not a prop, so
   * it costs the renderer contract nothing (no `surface`, no `isEditor`).
   * Computed here on the display route too: harmless and unused there, and
   * the alternative is a second copy of this check that only runs in the
   * editor, which is exactly the fork CLAUDE.md forbids.
   *
   * Observers, not a poll — plan.md §3e's "no setInterval accumulation" is
   * about a display route that runs for months, and an observer that only
   * fires when something actually changed costs nothing while nothing does.
   * ResizeObserver catches the box being dragged; MutationObserver catches
   * content changing size without the box moving, including a `fit`-mode
   * widget's own imperative font-size write (useFitFontSize.ts).
   *
   * A `hug` box's height check is skipped, not just usually-false: an
   * auto-height flex box can measure a few px of scrollHeight past its own
   * clientHeight from line-height/glyph-metrics rounding alone, with nothing
   * actually clipped — the height that would flag can never genuinely
   * overflow when it's computed from that exact content, so checking it can
   * only produce a false warning, never a true one. Width isn't hugged
   * (docs/sizing.md §2), so it still gets the real check.
   */
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;

    const check = () => {
      const overflowingWidth = el.scrollWidth > el.clientWidth + 1;
      const overflowingHeight = sizingMode !== "hug" && el.scrollHeight > el.clientHeight + 1;
      const overflowing = overflowingWidth || overflowingHeight;
      if (el.dataset.overflowing !== String(overflowing)) el.dataset.overflowing = String(overflowing);
    };

    check();
    const resize = new ResizeObserver(check);
    resize.observe(el);
    const mutate = new MutationObserver(check);
    mutate.observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style"],
    });

    return () => {
      resize.disconnect();
      mutate.disconnect();
    };
  }, [widget.config, widget.w, widget.h, canvas.width, canvas.height, sizingMode]);

  return (
    <div
      ref={frameRef}
      {...rest}
      className={`absolute overflow-hidden ${extraClassName}`}
      style={{
        left: `${widget.x}%`,
        top: `${widget.y}%`,
        width: `${widget.w}%`,
        height: sizingMode === "hug" ? "auto" : `${widget.h}%`,
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
