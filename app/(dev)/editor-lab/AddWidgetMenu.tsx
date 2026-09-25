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

/** The registry by category, in menu order. */
export const WIDGET_GROUPS = CATEGORY_ORDER.map((category) => ({
  category,
  name: CATEGORY_NAMES[category],
  widgets: WIDGET_MANIFESTS.filter((manifest) => manifest.category === category),
})).filter((group) => group.widgets.length > 0);

/**
 * Add an element at its default size, centred on `at` (design units) — or on
 * the middle of the canvas, which is where a person is looking — and kept
 * inside the canvas. The toolbar's menu and the right-click menu both add
 * through here.
 */
export function addWidget(id: string, at?: { x: number; y: number }) {
  const manifest = WIDGET_MANIFESTS.find((m) => m.id === id);
  if (!manifest) return;

  const store = useEditor.getState();
  const { canvas } = store;
  const w = Math.min(manifest.defaultSize.w, canvas.width);
  const h = Math.min(manifest.defaultSize.h, canvas.height);
  const cx = at?.x ?? canvas.width / 2;
  const cy = at?.y ?? canvas.height / 2;

  const widget = boardWidgetSchema.parse({
    id: crypto.randomUUID(),
    type: manifest.id,
    ...rectToWidget(
      {
        x: Math.round(Math.max(0, Math.min(cx - w / 2, canvas.width - w))),
        y: Math.round(Math.max(0, Math.min(cy - h / 2, canvas.height - h))),
        w,
        h,
      },
      canvas,
    ),
    z: store.doc.widgets.length,
    config: defaultConfig(manifest),
  });

  store.addWidgets([widget], `Add ${manifest.name.toLowerCase()}`);
}

export function AddWidgetMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  /** The room below the button, so a list longer than the window scrolls
   *  inside the menu rather than running off the bottom of the screen. */
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const bottom = summaryRef.current?.getBoundingClientRect().bottom ?? 0;
      setMaxHeight(Math.max(160, window.innerHeight - bottom - 4 - 12));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

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
    addWidget(id);
    setOpen(false);
  }

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
      <summary ref={summaryRef} className={`${CHROME_BUTTON} cursor-pointer list-none`}>
        Add element
      </summary>

      {/* A menu floats, which is what earns it the one shadow in the product. */}
      <div
        data-add-menu
        className="rounded-panel border-rule bg-surface absolute top-9 left-0 z-30 w-64 overflow-y-auto overscroll-contain border p-1 shadow-menu"
        style={{ maxHeight }}
      >
        {WIDGET_GROUPS.map((group, index) => (
          <div
            key={group.category}
            className={index > 0 ? "border-rule mt-1 border-t pt-1" : undefined}
          >
            <p className="text-meta text-ink-soft px-2 py-1">{group.name}</p>
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
