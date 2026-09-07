"use client";

import { useEffect, useRef, useState } from "react";
import { boardWidgetSchema } from "@/lib/board-doc";
import { rectToWidget } from "@/lib/editor/geometry";
import { useEditor } from "@/lib/editor/store";
import { WIDGET_MANIFESTS, defaultConfig } from "@/widgets/manifests";
import type { WidgetCategory } from "@/widgets/types";
import { CHROME_BUTTON } from "./chrome";

/*
 * The add menu, built from the registry.
 *
 * Nothing here names a widget. Adding a fourth folder puts a fourth row in this
 * menu with no edit to this file — plan.md §5, and the only way to check that
 * claim is to have a menu that would be wrong if it were false.
 */

const CATEGORY_ORDER: WidgetCategory[] = ["text", "time", "media", "content", "interactive"];
const CATEGORY_NAMES: Record<WidgetCategory, string> = {
  text: "Text",
  time: "Time",
  media: "Media",
  content: "From your shul",
  interactive: "Interactive",
};

const MENU_ITEM =
  "text-cell rounded-control text-ink hover:bg-verdigris-wash/40 " +
  "flex w-full flex-col items-start px-2 py-1 text-left";

export function AddWidgetMenu({ canvas }: { canvas: { width: number; height: number } }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function add(id: string) {
    const manifest = WIDGET_MANIFESTS.find((m) => m.id === id);
    if (!manifest) return;

    const store = useEditor.getState();
    const { defaultSize } = manifest;

    // Dropped in the middle of the canvas, which is where a person is looking.
    const widget = boardWidgetSchema.parse({
      id: crypto.randomUUID(),
      type: manifest.id,
      ...rectToWidget(
        {
          x: (canvas.width - defaultSize.w) / 2,
          y: (canvas.height - defaultSize.h) / 2,
          w: defaultSize.w,
          h: defaultSize.h,
        },
        canvas,
      ),
      z: store.doc.widgets.length,
      config: defaultConfig(manifest),
    });

    store.addWidgets([widget], `Add ${manifest.name.toLowerCase()}`);
    setOpen(false);
  }

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    widgets: WIDGET_MANIFESTS.filter((manifest) => manifest.category === category),
  })).filter((group) => group.widgets.length > 0);

  return (
    <details
      ref={ref}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="relative"
    >
      {/* "Add element" — docs/sizing.md §6: "element" is the editor UI's word
          for this; "widget" stays the word in code (folders, manifests,
          WIDGET_MANIFESTS below), unchanged. */}
      <summary className={`${CHROME_BUTTON} cursor-pointer list-none`}>Add element</summary>

      {/* A menu floats, which is what earns it the one shadow in the product. */}
      <div className="rounded-panel border-rule bg-surface absolute top-9 left-0 z-30 w-64 border p-1 shadow-menu">
        {grouped.map((group, index) => (
          <div
            key={group.category}
            className={index > 0 ? "border-rule mt-1 border-t pt-1" : undefined}
          >
            <p className="text-meta text-ink-soft px-2 py-1">{CATEGORY_NAMES[group.category]}</p>
            {group.widgets.map((manifest) => (
              <button key={manifest.id} type="button" onClick={() => add(manifest.id)} className={MENU_ITEM}>
                <span>{manifest.name}</span>
                <span className="text-min text-ink-soft">{manifest.description}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
