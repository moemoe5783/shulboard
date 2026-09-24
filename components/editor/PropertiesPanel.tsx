"use client";

import { createElement, useState } from "react";
import { CHROME_BUTTON, CHROME_BUTTON_ON, CHROME_DARK, CHROME_META, CHROME_RULE } from "@/app/(dev)/editor-lab/chrome";
import { widgetLabel } from "@/app/(dev)/editor-lab/labels";
import { AppearanceControls } from "@/components/editor/AppearanceControls";
import { BoardBackgroundField } from "@/components/editor/BackgroundField";
import { DimensionsField } from "@/components/editor/DimensionsField";
import { NumberField } from "@/components/editor/NumberField";
import { PANEL_LABEL } from "@/components/editor/panelControls";
import { useElementFontSize } from "@/components/editor/useElementFontSize";
import { useElementOverflow } from "@/components/editor/useElementOverflow";
import type { BoardBackground } from "@/lib/board-background";
import type { BoardWidget } from "@/lib/board-doc";
import { widgetRect } from "@/lib/editor/geometry";
import { matchPresets } from "@/lib/editor/size-presets";
import { GROUP_TYPE, useEditor, type EditorState } from "@/lib/editor/store";
import { getManifest } from "@/widgets/manifests";
import { getSettings } from "@/widgets/settings";
import { normalizeWidgetStyle, type WidgetStyleConfig } from "@/widgets/style";
import type { SizingMode, WidgetManifest } from "@/widgets/types";

/** The three groups of controls the panel splits a widget into — the widget's
 *  own options, the shared appearance, and how it sizes to its box. */
type PanelTab = "options" | "appearance" | "size";

/*
 * The properties panel — design.md §4's right rail, 264px, the same geometry
 * LayersPanel already draws on the other side of the canvas.
 *
 * §5: a widget's settings have exactly one definition, its settingsSchema, and
 * exactly one form for editing them, its Settings.tsx. This panel is not a
 * generic schema-to-form renderer — it looks up the selected widget's own
 * Settings component and gets out of the way, the same division of labour
 * BoardRenderer already has with a widget's Renderer.tsx.
 */

export function PropertiesPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const setWidgetConfig = useEditor((s) => s.setWidgetConfig);

  const selected = doc.widgets.filter(
    (widget) => selection.includes(widget.id) && widget.type !== GROUP_TYPE,
  );

  return (
    <aside
      {...CHROME_DARK}
      className={`font-ui flex w-66 shrink-0 flex-col border-l ${CHROME_RULE}`}
    >
      <Body selected={selected} setWidgetConfig={setWidgetConfig} />
    </aside>
  );
}

function Body({
  selected,
  setWidgetConfig,
}: {
  selected: BoardWidget[];
  setWidgetConfig: EditorState["setWidgetConfig"];
}) {
  // Called unconditionally, before the early returns below — Rules of Hooks —
  // and null for anything but a single selection, which is what makes it a
  // no-op the rest of the time.
  const overflowing = useElementOverflow(selected.length === 1 ? selected[0].id : null);
  const applyRects = useEditor((s) => s.applyRects);
  const canvas = useEditor((s) => s.canvas);
  // Which group of controls is showing. Kept across selection changes on
  // purpose — a gabbai restyling several widgets in a row stays on the
  // Appearance tab rather than being thrown back to Options each click.
  const [tab, setTab] = useState<PanelTab>("options");

  /*
   * Resize a fit-mode widget's BOX so its content renders at `target` design
   * units — docs/sizing.md's properties-panel field, now editable in fit mode
   * rather than read-only. Because a fit widget's type scales linearly with the
   * box on both axes (widgets/useFitFontSize.ts and widgets/zmanim/fit.ts both
   * take the smaller of the two drivers, and scaling the box uniformly scales
   * both), the box just multiplies by `target / fitted`. Anchored on the box's
   * centre so the element stays put rather than drifting toward a corner as it
   * grows or shrinks. Single selection only — the fitted size is per-widget.
   */
  const resizeToTypeSize = (target: number, fitted: number) => {
    if (selected.length !== 1 || fitted <= 0) return;
    const widget = selected[0];
    const k = target / fitted;
    const rect = widgetRect(widget, canvas);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const w = rect.w * k;
    const h = rect.h * k;
    applyRects("Resize to type size", { [widget.id]: { x: cx - w / 2, y: cy - h / 2, w, h } });
    // Keep a `size` field, where the widget has one, in step with the size the
    // box now renders at — it's what the relative padding and header scale
    // against (widgets/style.ts) and what persists the intended size.
    if (typeof (widget.config as { size?: unknown }).size === "number") {
      setWidgetConfig([widget.id], { size: Math.round(target) });
    }
  };

  if (selected.length === 0) {
    return <BoardSettings />;
  }

  const types = new Set(selected.map((widget) => widget.type));

  if (types.size > 1) {
    return (
      <div className="p-3">
        <h2 className={`${CHROME_META} mb-1`}>Properties</h2>
        <p className="text-body text-paper">{selected.length} elements selected</p>
        <p className={`${CHROME_META} mt-1`}>
          They&rsquo;re different kinds of element, so there&rsquo;s nothing they all
          share to edit together.
        </p>
      </div>
    );
  }

  const type = selected[0].type;
  const manifest = getManifest(type);
  const Settings = getSettings(type);
  const ids = selected.map((widget) => widget.id);
  // Every selected widget shares a type, so its config shape is the same one —
  // the first stands in for all of them, and a field only reads back "mixed"
  // if a caller wanted that, which no widget's settings ask for yet.
  const config = selected[0].config as { sizingMode?: SizingMode; size?: number };

  const showSizing = Boolean(manifest?.sizing.userToggleable) || Boolean(manifest && isTextSized(manifest));
  // Every single element has a size to show (DimensionsField), so the tab is
  // always there for one; for several it's only there when there's sizing to
  // set or a clip to warn about.
  const sizeTabVisible = selected.length === 1 || showSizing || overflowing;
  const styleConfig = normalizeWidgetStyle(selected[0].config as Record<string, unknown>);
  // The Size tab can vanish when the selection changes to a widget with nothing
  // to size; fall the pane back to Options rather than render an empty one.
  const activeTab: PanelTab = tab === "size" && !sizeTabVisible ? "options" : tab;

  return (
    <>
      <h2
        className={`${CHROME_META} flex h-10 shrink-0 items-center border-b px-3 ${CHROME_RULE}`}
      >
        {selected.length > 1
          ? `${selected.length} ${manifest?.name.toLowerCase() ?? type} elements`
          : widgetLabel(selected[0])}
      </h2>

      {/* The size at a glance, whatever tab is open — click an element and
          this says how big it is, and whether it's a photo or flyer shape. */}
      {selected.length === 1 && (
        <button
          type="button"
          onClick={() => setTab("size")}
          className={`${CHROME_META} hover:text-paper flex h-8 shrink-0 items-center border-b px-3 text-left ${CHROME_RULE}`}
          data-size-summary
        >
          <SizeSummary widget={selected[0]} />
        </button>
      )}

      <TabBar tab={activeTab} onChange={setTab} showSize={sizeTabVisible} />

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {/* Options — the widget's own settings, and only those. */}
        {activeTab === "options" &&
          (Settings ? (
            // createElement, not JSX: the lint rule against components created
            // during render cannot tell a lookup in a module-level map (stable
            // for the life of the bundle — widgets/settings.ts builds it once)
            // from a component defined inline, and flags the second while
            // meaning the first. Same reasoning as BoardRenderer.tsx's Renderer.
            createElement(Settings, {
              config: config as never,
              onChange: (patch: Record<string, unknown>) => setWidgetConfig(ids, patch),
              widgetIds: ids,
            })
          ) : (
            <p className={CHROME_META}>
              {manifest ? `${manifest.name} has nothing to configure yet.` : "This element has no settings."}
            </p>
          ))}

        {/* Appearance — the shared design controls every widget carries. */}
        {activeTab === "appearance" && (
          <AppearanceControls
            config={styleConfig}
            onChange={(patch: Partial<WidgetStyleConfig>) => setWidgetConfig(ids, patch)}
          />
        )}

        {/* Size — how the widget fits its box, plus the clip warning. */}
        {activeTab === "size" && (
          <>
            {selected.length === 1 && <DimensionsField widget={selected[0]} />}

            {manifest?.sizing.userToggleable && (
              <SizingToggle
                mode={config.sizingMode ?? manifest.sizing.mode}
                recommended={manifest.sizing.recommended}
                onChange={(mode) => setWidgetConfig(ids, { sizingMode: mode })}
              />
            )}

            {manifest && isTextSized(manifest) && (
              <TypeSizeField
                widgetId={selected[0].id}
                mode={config.sizingMode ?? manifest.sizing.mode}
                size={config.size}
                onChange={(size) => setWidgetConfig(ids, { size })}
                // Editable-in-fit (resize the box to the typed size) only for a
                // widget whose ONLY mode is fit — zmanim, candle lighting, title.
                // A widget that also offers Fixed (userToggleable) keeps fit
                // read-only: setting a number there means switching to Fixed,
                // which is the whole point of having the toggle. Single
                // selection only — the fitted size is per-widget.
                onResizeToFit={
                  selected.length === 1 && !manifest.sizing.userToggleable ? resizeToTypeSize : undefined
                }
              />
            )}

            {overflowing && (
              <p className="text-meta text-stale border-paper/15 border-b pb-3">
                This doesn&rsquo;t fit its box on the screen — the rest is clipped,
                not shown. Make the box bigger or shorten the content.
              </p>
            )}

            {!showSizing && !overflowing && selected.length !== 1 && (
              <p className={CHROME_META}>This element sizes itself to its box — nothing to set.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** "600 × 900 px, 4 × 6 in photo" — the one-line version of DimensionsField. */
function SizeSummary({ widget }: { widget: BoardWidget }) {
  const canvas = useEditor((s) => s.canvas);
  const rect = widgetRect(widget, canvas);
  const preset = matchPresets(rect.w, rect.h)[0];
  return (
    <span className="numeric truncate">
      {Math.round(rect.w)} × {Math.round(rect.h)} px{preset ? `, ${preset.label}` : ""}
    </span>
  );
}

/**
 * With nothing selected, the panel edits the BOARD: its background (a colour,
 * gradient or picture — lib/board-background.ts) and whether its text is dark
 * or light. Choosing a background switches the text to whichever reads on it,
 * so a dark picture never leaves dark text on it; the choice
 * can still be flipped by hand, and both are undoable like any edit.
 */
function BoardSettings() {
  const doc = useEditor((s) => s.doc);
  const setBoardStyle = useEditor((s) => s.setBoardStyle);
  const background = doc.background as BoardBackground;
  const theme = doc.themeOverrides as { ink?: string };
  const lightText = theme.ink === "surface" || theme.ink === "paper";

  const setInk = (ink: "ink" | "surface", label = "Change board text colour") =>
    setBoardStyle({ themeOverrides: { ...doc.themeOverrides, ink } }, label);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3" data-board-settings>
      <h2 className={`${CHROME_META} mb-1`}>Board</h2>
      <p className={`${CHROME_META} mb-4`}>
        Nothing selected, so these settings are for the whole board. Pick an element to edit it instead.
      </p>

      <div className="flex flex-col gap-2">
        <span className={PANEL_LABEL}>Background</span>
        <BoardBackgroundField
          value={background}
          onChange={(next, tone) => {
            const ink = tone === "dark" ? "surface" : tone === "light" ? "ink" : undefined;
            setBoardStyle(
              ink ? { background: next, themeOverrides: { ...doc.themeOverrides, ink } } : { background: next },
              "Change board background",
            );
          }}
        />
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <span className={PANEL_LABEL}>Text</span>
        <div className="flex gap-2">
          {(
            [
              [false, "Dark text"],
              [true, "Light text"],
            ] as const
          ).map(([light, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={lightText === light}
              onClick={() => setInk(light ? "surface" : "ink")}
              className={`${CHROME_BUTTON} flex-1 border ${lightText === light ? `${CHROME_BUTTON_ON} border-transparent` : "border-paper/20"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className={PANEL_LABEL}>Set automatically when you choose a background. Elements can override it on their Appearance tab.</p>
      </div>
    </div>
  );
}

/**
 * The three tabs — the widget's own options, the shared appearance, and how it
 * sizes to its box (design/appearance and sizing each get their own section,
 * with widget-specific settings kept separate). The Size tab is hidden for a
 * widget with nothing to size (an image, which fills its box either way) unless
 * it is actively overflowing, where the warning lives.
 */
function TabBar({ tab, onChange, showSize }: { tab: PanelTab; onChange: (tab: PanelTab) => void; showSize: boolean }) {
  const tabs: { value: PanelTab; label: string }[] = [
    { value: "options", label: "Options" },
    { value: "appearance", label: "Appearance" },
    ...(showSize ? [{ value: "size" as const, label: "Size" }] : []),
  ];

  return (
    <div className={`flex shrink-0 gap-1 border-b px-2 py-2 ${CHROME_RULE}`}>
      {tabs.map((one) => (
        <button
          key={one.value}
          type="button"
          aria-pressed={tab === one.value}
          onClick={() => onChange(one.value)}
          className={`${CHROME_BUTTON} flex-1 border ${
            tab === one.value ? `${CHROME_BUTTON_ON} border-transparent` : "border-paper/20"
          }`}
        >
          {one.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The Fit to box / Fixed size / Hug height control — docs/sizing.md §2, "The
 * toggle." Generic, in the panel itself, rather than duplicated into every
 * userToggleable widget's own Settings.tsx: the manifest is what decides
 * whether it shows, and every widget that opts in gets all three for free by
 * writing `sizingMode` into its config schema.
 */
function SizingToggle({
  mode,
  recommended,
  onChange,
}: {
  mode: SizingMode;
  recommended?: SizingMode;
  onChange: (mode: SizingMode) => void;
}) {
  const options = [
    { value: "fit" as const, label: "Fit to box" },
    { value: "fixed" as const, label: "Fixed size" },
    { value: "hug" as const, label: "Hug height" },
  ];

  return (
    <div className="border-paper/15 mb-3 border-b pb-3">
      <span className={`${PANEL_LABEL} mb-1 block`}>Sizing</span>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            onClick={() => onChange(option.value)}
            className={`${CHROME_BUTTON} flex-1 border ${
              mode === option.value ? `${CHROME_BUTTON_ON} border-transparent` : "border-paper/20"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {/*
        A line under the control rather than "(recommended)" appended to an
        option's label. Three buttons share a 264px rail (design.md §4), so
        the labels are already at their limit — a fourth word inside one of
        them would wrap it and make that button taller than its neighbours,
        which reads as a rendering bug rather than as advice.
      */}
      {recommended && recommended !== mode && (
        <p className={`${PANEL_LABEL} mt-1`}>
          {options.find((option) => option.value === recommended)?.label} is recommended for this element.
        </p>
      )}
    </div>
  );
}

/**
 * A widget counts as "text-sized" — worth showing a type-size field for —
 * when its category is one docs/sizing.md actually writes about type filling
 * or declaring a size: `text`, `time` and `content`. `media` (Image, and
 * later Video/Gallery/Collage) is exactly the category §2 carves out as
 * having no font size for a mode to drive.
 *
 * `content` IS THE CASE THIS COMMENT USED TO ANTICIPATE, and the answer
 * turned out to be smaller than expected. It read: "worth promoting to an
 * explicit manifest field the day a `content`-category widget (a Zmanim
 * table, with a size per row rather than one scalar) needs a genuinely
 * different shape than a single number." That widget now exists
 * (widgets/zmanim) and it does not need a different shape: one type size
 * drives every row, and the labels and times inside a row are scaled off it
 * in `em`. So this stays a heuristic on the category rather than becoming a
 * manifest flag — the flag would have exactly one value on every manifest.
 * Still worth promoting the day a widget really does want a size per part.
 */
function isTextSized(manifest: WidgetManifest<never>): boolean {
  // A widget with text to size declares its type-size bounds; one in these
  // categories without them (the QR code) has nothing for the Size tab to set.
  const textCategory = manifest.category === "text" || manifest.category === "time" || manifest.category === "content";
  return textCategory && manifest.sizing.minFontSize !== undefined;
}

/**
 * An objective, visible type size — docs/sizing.md's properties-panel
 * requirement, in board design units in every sizing mode.
 *
 * In `fit` mode it shows the computed result, read live off the DOM. It is
 * EDITABLE when a single widget is selected (`onResizeToFit` is provided):
 * typing a size resizes the box so the content renders at it, rather than the
 * author dragging the box until the read-only number lands where they want.
 * The box stays authoritative — the field drives the box, the box drives the
 * type — so on the board a busier day still shrinks the type to fit rather than
 * overflowing. With more than one widget selected there is no single fitted
 * size to edit, so it falls back to read-only.
 *
 * In `fixed`/`hug` it's the declared value driving the render — the editable
 * field this used to be per-widget (e.g. clock/Settings.tsx's old "Size" field)
 * before every mode needed the same treatment in one place.
 */
function TypeSizeField({
  widgetId,
  mode,
  size,
  onChange,
  onResizeToFit,
}: {
  widgetId: string;
  mode: SizingMode;
  size: number | undefined;
  onChange: (size: number) => void;
  onResizeToFit?: (target: number, fitted: number) => void;
}) {
  // Only meaningful in fit mode, but calling the hook unconditionally keeps
  // Rules of Hooks simple — reading it here costs nothing when unused.
  const fitted = useElementFontSize(widgetId);

  if (mode === "fit") {
    if (onResizeToFit && fitted !== null) {
      return (
        <div className="mb-3">
          <NumberField
            label="Type size"
            value={fitted}
            onChange={(target) => onResizeToFit(target, fitted)}
            min={8}
            max={400}
            title="Resizes the box so the content renders at this size. A busier day still shrinks to fit."
          />
        </div>
      );
    }
    return (
      <div className="mb-3">
        <NumberField
          label="Type size"
          value={fitted ?? undefined}
          onChange={() => {}}
          min={8}
          max={400}
          disabled
          title="Set by the box in fit mode — drag the box to change it."
        />
      </div>
    );
  }

  return (
    <div className="mb-3">
      <NumberField label="Type size" value={size} onChange={onChange} min={8} max={400} />
    </div>
  );
}
