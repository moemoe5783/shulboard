"use client";

import { createElement, useEffect, useRef, type CSSProperties, type HTMLAttributes } from "react";
import { BoardAssetsProvider, type BoardFiles } from "@/lib/board-assets";
import { BoardLocationProvider, type BoardLocation } from "@/lib/board-location";
import { BoardZmanimProvider, type BoardZmanim } from "@/lib/board-zmanim";
import type { BoardDoc, BoardWidget } from "@/lib/board-doc";
import type { BoardAlbums } from "@/lib/media/album-photos";
import { boardLength, boardRootStyle } from "@/lib/board-theme";
import { getManifest } from "@/widgets/manifests";
import { boardFontRoles, type BoardFontRoles } from "@/lib/fonts/roles";
import { fontStack } from "@/lib/fonts/stack";
import { getRenderer } from "@/widgets/renderers";
import { cappedHeaderSize, normalizeWidgetStyle, referenceSizeOf, widgetBoxStyle, widgetStyle } from "@/widgets/style";
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
  /**
   * Where this board is being shown — the screen's own coordinates in the
   * display route, the org's in the editor (a board isn't tied to one screen,
   * so there is no single "right" screen to preview against; see
   * lib/board-location.tsx). `null`/omitted for a context with no location at
   * all (a demo page, an org that hasn't set one yet) — location-dependent
   * widgets are responsible for their own empty state in that case.
   */
  location?: BoardLocation | null;
  /** The board's zmanim provider config — lib/board-zmanim.tsx. Omitted
   *  wherever nothing resolves it (editor-lab, font-parity, any page that
   *  doesn't carry a real org/screen) falls back to that module's
   *  DEFAULT_BOARD_ZMANIM: Chabad, with no location on file. Those pages
   *  therefore show a zmanim or candle-lighting widget's "hasn't set a ZIP"
   *  empty state, which is the same thing a real shul with no ZIP sees. */
  zmanim?: BoardZmanim | null;
  /** Album photos the Gallery/Collage widgets show, resolved from the bundle on
   *  a display and from a live query in the editor (lib/board-assets.tsx).
   *  Omitted wherever nothing resolves them, where those widgets show their own
   *  empty state. */
  albums?: BoardAlbums | null;
  /** Which photo files are on this device (lib/board-assets.tsx). The display
   *  passes it; the editor doesn't, and there every file counts as ready. */
  files?: BoardFiles | null;
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
  location = null,
  zmanim = null,
  albums = null,
  files = null,
}: BoardRendererProps) {
  // The board's heading, body, accent and quote fonts (lib/fonts/roles.ts).
  const roles = boardFontRoles(doc.themeOverrides);
  return (
    <BoardLocationProvider location={location}>
      <BoardZmanimProvider zmanim={zmanim}>
        <BoardAssetsProvider albums={albums} files={files}>
        <div
          className={`relative overflow-hidden ${className}`}
          style={{
            // The container every board length is measured against. `cqw`
            // resolves to the nearest container ancestor, so this must be the
            // only one between the board root and a widget — otherwise a
            // widget's type would silently start scaling against the widget
            // instead of the board.
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
                roles={roles}
                extra={widgetProps?.(widget)}
              />
            ))}
        </div>
        </BoardAssetsProvider>
      </BoardZmanimProvider>
    </BoardLocationProvider>
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
  roles,
  extra,
}: {
  widget: BoardWidget;
  canvas: { width: number; height: number };
  roles: BoardFontRoles;
  extra?: HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
}) {
  const Renderer = getRenderer(widget.type);
  const { className: extraClassName = "", style: extraStyle, ...rest } = extra ?? {};
  const frameRef = useRef<HTMLDivElement>(null);

  /*
   * THE APPEARANCE FRAME, ONE PLACE FOR EVERY WIDGET. Background, padding,
   * radius, border, shadow, colour, font and an optional header (widgets/style.ts)
   * are applied here rather than inside each Renderer — so every widget gets them
   * without a per-folder edit, and a widget's Renderer stays `{config, canvas}`
   * and nothing else (CLAUDE.md's no-fork rule). The Renderer sits inside this
   * frame's content area, so a `fit`-mode widget measures the padded, header-less
   * space it actually has, with no coordination between the two.
   */
  const style = normalizeWidgetStyle(widget.config as Record<string, unknown>);
  // The widget's own text size, in design units — what the relative padding and
  // header size scale against (widgets/style.ts). A size-14 zmanim gets a small
  // frame and header; a size-100 title a large one, from the same ratios.
  const referenceSize = referenceSizeOf(widget.config as Record<string, unknown>);

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

  // The widget's box in design units, so the frame's padding and header can be
  // capped against it (widgets/style.ts). Height is Infinity in `hug` mode,
  // where the box grows to fit and there is nothing fixed to consume.
  const boxDesign = {
    width: (widget.w / 100) * canvas.width,
    height: sizingMode === "hug" ? Infinity : (widget.h / 100) * canvas.height,
  };
  const headerSize = cappedHeaderSize(style.titleSize, referenceSize, boxDesign.height);

  // Which board font role this widget's text takes by default: heading for a
  // Title, body for the rest (lib/fonts/roles.ts).
  const fontRole = getManifest(widget.type)?.fontRole ?? "body";
  const headerFont =
    style.title &&
    style.font === "inherit" &&
    style.hebrewFont === "inherit" &&
    fontRole !== "heading" &&
    (roles.heading.font !== roles.body.font || roles.heading.hebrew !== roles.body.hebrew)
      ? fontStack(roles.heading.font, roles.heading.hebrew)
      : undefined;

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
        ...widgetBoxStyle(style, canvas.width),
        ...extraStyle,
      }}
    >
      {/*
        The appearance frame fills the positioned box and stacks an optional
        header above the widget's own content (widgets/style.ts). When nothing is
        styled it is a transparent, padding-less flex pass-through, so an
        unstyled widget renders exactly as it did before this frame existed.
      */}
      <div style={widgetStyle(style, canvas.width, referenceSize, boxDesign, { roles, role: fontRole })}>
        {style.title && (
          <div
            dir="auto"
            style={{
              // A header is set in the heading font — unless the element has a
              // font of its own, which its header shares.
              fontFamily: headerFont,
              flexShrink: 0,
              fontWeight: "var(--board-weight-semibold, 600)",
              textAlign: style.titleAlign,
              unicodeBidi: "plaintext",
              lineHeight: 1.1,
              // titleSize is a multiple of the widget's own text size, capped
              // against the box height so it can't consume a short box (same
              // reason as padding — widgets/style.ts).
              fontSize: boardLength(headerSize, canvas.width),
              marginBottom: boardLength(headerSize * style.titleGap, canvas.width),
            }}
          >
            {style.title}
          </div>
        )}
        <div className="relative min-h-0 min-w-0 flex-1">
          {/*
            createElement rather than <Renderer />, and not for style: the lint
            rule against components created during render cannot tell a lookup in
            a module-level map from a component defined inline, and flags the
            second while meaning the first. The identity here is stable for the
            life of the bundle — widgets/renderers.ts builds the map once — so the
            remounting the rule protects against cannot happen.
          */}
          {Renderer
            ? createElement(Renderer, { config: widget.config as never, canvas })
            : <UnknownWidget type={widget.type} />}
        </div>
      </div>
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
