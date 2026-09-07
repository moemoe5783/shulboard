"use client";

import { createElement } from "react";
import { CHROME_DARK, CHROME_META, CHROME_RULE } from "@/app/(dev)/editor-lab/chrome";
import { widgetLabel } from "@/app/(dev)/editor-lab/labels";
import type { BoardWidget } from "@/lib/board-doc";
import { GROUP_TYPE, useEditor, type EditorState } from "@/lib/editor/store";
import { getManifest } from "@/widgets/manifests";
import { getSettings } from "@/widgets/settings";

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
  if (selected.length === 0) {
    return (
      <div className="p-3">
        <h2 className={`${CHROME_META} mb-1`}>Properties</h2>
        <p className="text-body text-paper">Nothing selected</p>
        <p className={`${CHROME_META} mt-1`}>
          Pick a widget on the board or in the layers list to edit it here.
        </p>
      </div>
    );
  }

  const types = new Set(selected.map((widget) => widget.type));

  if (types.size > 1) {
    return (
      <div className="p-3">
        <h2 className={`${CHROME_META} mb-1`}>Properties</h2>
        <p className="text-body text-paper">{selected.length} widgets selected</p>
        <p className={`${CHROME_META} mt-1`}>
          They&rsquo;re different kinds of widget, so there&rsquo;s nothing they all
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
  const config = selected[0].config;

  return (
    <>
      <h2
        className={`${CHROME_META} flex h-10 shrink-0 items-center border-b px-3 ${CHROME_RULE}`}
      >
        {selected.length > 1
          ? `${selected.length} ${manifest?.name.toLowerCase() ?? type} widgets`
          : widgetLabel(selected[0])}
      </h2>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {Settings ? (
          // createElement, not JSX: the lint rule against components created
          // during render cannot tell a lookup in a module-level map (stable
          // for the life of the bundle — widgets/settings.ts builds it once)
          // from a component defined inline, and flags the second while
          // meaning the first. Same reasoning as BoardRenderer.tsx's Renderer.
          createElement(Settings, {
            config: config as never,
            onChange: (patch: Record<string, unknown>) => setWidgetConfig(ids, patch),
          })
        ) : (
          <p className={CHROME_META}>
            {manifest ? `${manifest.name} has nothing to configure yet.` : "This widget has no settings."}
          </p>
        )}
      </div>
    </>
  );
}
