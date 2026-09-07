"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CHROME_DARK, CHROME_META, CHROME_RULE } from "@/app/(dev)/editor-lab/chrome";
import { ContextMenu, type MenuPosition } from "@/app/(dev)/editor-lab/ContextMenu";
import { LayersPanel } from "@/app/(dev)/editor-lab/LayersPanel";
import { Toolbar } from "@/app/(dev)/editor-lab/Toolbar";
import { BoardRenderer } from "@/components/board/BoardRenderer";
import { TransformFrame } from "@/components/editor/TransformFrame";
import { PropertiesPanel } from "@/components/editor/PropertiesPanel";
import type { BoardDoc } from "@/lib/board-doc";
import { GROUP_TYPE, useEditor } from "@/lib/editor/store";
import { saveBoardDoc } from "./actions";

/*
 * The real editor. plan.md §4 and design.md §4, with a database on the other
 * end of it rather than nothing.
 *
 * DELIBERATELY A THIN SHELL AROUND WHAT editor-lab/EditorLab.tsx ALREADY
 * PROVES. The canvas, the transform layer, the toolbar, the layers panel and
 * the right-click menu are unchanged — every one of them already takes its
 * whole picture from the Zustand store and knows nothing about where the
 * document came from, which is what makes them reusable at all. What is
 * actually new here is: loading a real board instead of the hardcoded demo
 * document, saving back to it, and the properties panel.
 *
 * THE KEYBOARD HANDLER BELOW IS A DELIBERATE DUPLICATE of the one in
 * EditorLab.tsx, not an oversight. Editor-lab stays exactly as it is — it is
 * useful precisely because it needs no database — so extracting a shared hook
 * would mean editing it anyway. If a third editor surface ever needs this,
 * that is the moment to factor it out; two copies is not yet the problem one
 * shared hook would be solving.
 */

const NUDGE_SMALL = 1;
const NUDGE_LARGE = 10;

export type BoardEditorProps = {
  boardId: string;
  name: string;
  canvas: { width: number; height: number };
  doc: unknown;
};

export function BoardEditor({ boardId, name, canvas, doc }: BoardEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const liveDoc = useEditor((s) => s.doc);
  const zoom = useEditor((s) => s.zoom);
  const showGrid = useEditor((s) => s.showGrid);
  const gridSize = useEditor((s) => s.gridSize);
  const selection = useEditor((s) => s.selection);
  const setZoom = useEditor((s) => s.setZoom);
  const ready = useEditor((s) => s.loaded);

  const [menu, setMenu] = useState<MenuPosition | null>(null);

  // ---- load the real document, once -------------------------------------

  useEffect(() => {
    useEditor.getState().load(doc, canvas);
    // Only on mount: boardId does not change under a mounted editor (leaving
    // one board and opening another is a navigation, which remounts this
    // component and its useEffects fresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- autosave, debounced 1s, with a save indicator ---------------------

  type SaveState = "idle" | "saving" | "saved" | "error";
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isSaving, startSaving] = useTransition();
  const pendingDocRef = useRef<BoardDoc | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const flushSave = useCallback(() => {
    const next = pendingDocRef.current;
    if (!next) return;
    pendingDocRef.current = null;

    startSaving(async () => {
      if (mountedRef.current) setSaveState("saving");
      const result = await saveBoardDoc(boardId, next);
      if (!mountedRef.current) return;
      setSaveState(result.ok ? "saved" : "error");
    });
  }, [boardId]);

  useEffect(() => {
    // Registered in its own effect, which mounts strictly after the load()
    // effect above has already run and already changed `doc` once — there is
    // no subscriber attached yet when that happens, so this callback never
    // sees the load itself, only edits made afterward. That is what makes a
    // separate "skip the first change" flag unnecessary: by construction,
    // there isn't a first spurious change for it to skip.
    return useEditor.subscribe((state, previous) => {
      if (state.doc === previous.doc) return;

      pendingDocRef.current = state.doc;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(flushSave, 1000);
    });
  }, [flushSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  /** Zoom to fit, which is where the editor opens (§4a). */
  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const padding = 64;
    setZoom(
      Math.min(
        (viewport.clientWidth - padding) / canvas.width,
        (viewport.clientHeight - padding) / canvas.height,
      ),
    );
  }, [setZoom, canvas.width, canvas.height]);

  useEffect(() => {
    if (!ready) return;
    fit();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ---- keyboard — §4b, duplicated from EditorLab.tsx; see the file comment --

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

  const canvasPx = { width: canvas.width * zoom, height: canvas.height * zoom };

  return (
    <div className="bg-ink text-paper font-ui flex h-screen flex-col">
      <Header name={name} boardId={boardId} saveState={saveState} isSaving={isSaving} />
      <Toolbar onFit={fit} canvas={canvas} />

      <div className="flex min-h-0 flex-1">
        <LayersPanel />

        <div
          ref={viewportRef}
          data-editor-viewport
          className="bg-ink/88 relative min-w-0 flex-1 overflow-auto"
          onContextMenu={(event) => {
            event.preventDefault();
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

              <BoardRenderer
                doc={liveDoc}
                canvas={canvas}
                className="h-full w-full"
                widgetProps={(widget) => ({
                  "data-widget-id": widget.id,
                  "data-locked": widget.locked ? "true" : undefined,
                  className: `select-none [&_*]:pointer-events-none ${
                    widget.locked ? "cursor-not-allowed" : "cursor-move"
                  }`,
                })}
              />
            </div>
          </div>

          {ready && <TransformFrame canvasRef={canvasRef} viewportRef={viewportRef} />}
        </div>

        <PropertiesPanel />
      </div>

      <StatusBar
        count={liveDoc.widgets.filter((w) => w.type !== GROUP_TYPE).length}
        selected={selection.length}
      />

      <ContextMenu at={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

function Header({
  name,
  boardId,
  saveState,
  isSaving,
}: {
  name: string;
  boardId: string;
  saveState: "idle" | "saving" | "saved" | "error";
  isSaving: boolean;
}) {
  const label =
    isSaving || saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Couldn't save"
        : saveState === "saved"
          ? "Saved"
          : null;

  return (
    <div
      {...CHROME_DARK}
      className={`flex h-10 shrink-0 items-center gap-3 border-b px-3 ${CHROME_RULE}`}
    >
      <Link href="/boards" className={`${CHROME_META} hover:text-paper`}>
        ← Boards
      </Link>
      <span className="text-cell text-paper min-w-0 truncate font-semibold">{name}</span>
      {label && (
        <span
          className={`${CHROME_META} ml-auto`}
          role={saveState === "error" ? "alert" : undefined}
          data-board-save-state={saveState}
          data-board-id={boardId}
        >
          {label}
        </span>
      )}
    </div>
  );
}

function StatusBar({ count, selected }: { count: number; selected: number }) {
  return (
    <div
      {...CHROME_DARK}
      className={`font-ui border-paper/15 text-meta text-paper/60 numeric flex h-8 shrink-0 items-center gap-4 border-t px-3`}
    >
      {/* "element(s)" — docs/sizing.md §6. "widget" stays the word in code. */}
      <span>
        {count} {count === 1 ? "element" : "elements"}
      </span>
      <span>{selected} selected</span>
      <span className="ml-auto">
        Hold ctrl or cmd to suspend snapping. Alt-drag to duplicate. Shift to constrain.
      </span>
    </div>
  );
}
