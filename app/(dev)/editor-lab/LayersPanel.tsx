"use client";

import { GROUP_TYPE, useEditor } from "@/lib/editor/store";
import { widgetLabel } from "./labels";
import { CHROME_DARK, CHROME_META, CHROME_RULE } from "./chrome";

/*
 * The layers panel — §4b, and the left rail in design.md §4's editor wireframe.
 *
 * Top of the list is the front of the board, which is how every editor does it
 * and the opposite of how z sorts. Group rows are not shown: a group is a row in
 * the document, not a thing on the canvas, and its members are what a person
 * points at.
 */

export function LayersPanel() {
  const widgets = useEditor((s) => s.doc.widgets);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const toggleSelected = useEditor((s) => s.toggleSelected);
  const setLocked = useEditor((s) => s.setLocked);
  const setHidden = useEditor((s) => s.setHidden);

  const rows = widgets
    .filter((widget) => widget.type !== GROUP_TYPE)
    .slice()
    .sort((a, b) => b.z - a.z);

  return (
    <aside
      {...CHROME_DARK}
      className={`font-ui flex w-50 shrink-0 flex-col border-r ${CHROME_RULE}`}
    >
      <h2 className={`${CHROME_META} flex h-10 shrink-0 items-center border-b px-3 ${CHROME_RULE}`}>
        Layers
      </h2>

      {rows.length === 0 ? (
        <div className="p-3">
          {/* "element" — docs/sizing.md §6. "widget" is unchanged in code. */}
          <p className="text-body text-paper">Add your first element</p>
          <p className={`${CHROME_META} mt-1`}>
            Everything on the board is listed here, front to back.
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto p-1">
          {rows.map((widget) => {
            const active = selection.includes(widget.id);
            const name = widgetLabel(widget);

            return (
              <li key={widget.id} className="flex items-center">
                <button
                  type="button"
                  onClick={(event) =>
                    event.shiftKey ? toggleSelected(widget.id) : select([widget.id])
                  }
                  aria-pressed={active}
                  className={`text-cell rounded-control flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left ${
                    // Active-nav treatment, not a primary fill — same reason as
                    // the toolbar's toggles. A selected row is a state.
                    active
                      ? "bg-verdigris-wash text-verdigris"
                      : "text-paper hover:bg-paper/10"
                  } ${widget.hidden ? "opacity-50" : ""}`}
                >
                  <span className="min-w-0 truncate">{name}</span>
                  {widget.groupId && (
                    <span className="text-min text-paper/60 ml-auto shrink-0">grouped</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setHidden([widget.id], !widget.hidden)}
                  aria-pressed={widget.hidden}
                  aria-label={`${widget.hidden ? "Show" : "Hide"} ${name}`}
                  className={`text-min rounded-control h-8 w-12 shrink-0 hover:bg-paper/10 ${
                    widget.hidden ? "text-verdigris" : "text-paper/60"
                  }`}
                >
                  {/* The button says what pressing it does, and keeps that name
                      in both states — design.md §6. It said "hide" one way and
                      "shown" the other, which is an action and a state wearing
                      the same button. */}
                  {widget.hidden ? "Show" : "Hide"}
                </button>

                <button
                  type="button"
                  onClick={() => setLocked([widget.id], !widget.locked)}
                  aria-pressed={widget.locked}
                  aria-label={`${widget.locked ? "Unlock" : "Lock"} ${name}`}
                  className={`text-min rounded-control h-8 w-14 shrink-0 hover:bg-paper/10 ${
                    widget.locked ? "text-verdigris" : "text-paper/60"
                  }`}
                >
                  {widget.locked ? "Unlock" : "Lock"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
