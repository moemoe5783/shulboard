"use client";

import { GROUP_TYPE, useEditor } from "@/lib/editor/store";
import { CHROME_META, CHROME_RULE } from "./chrome";

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
    <aside className={`font-ui flex w-50 shrink-0 flex-col border-r ${CHROME_RULE}`}>
      <h2 className={`${CHROME_META} flex h-10 shrink-0 items-center border-b px-3 ${CHROME_RULE}`}>
        Layers
      </h2>

      {rows.length === 0 ? (
        <div className="p-3">
          <p className="text-body text-paper">Add your first box</p>
          <p className={`${CHROME_META} mt-1`}>
            Everything on the board is listed here, front to back.
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto p-1">
          {rows.map((widget) => {
            const active = selection.includes(widget.id);
            const name = labelOf(widget.config, widget.id);

            return (
              <li key={widget.id} className="flex items-center">
                <button
                  type="button"
                  onClick={(event) =>
                    event.shiftKey ? toggleSelected(widget.id) : select([widget.id])
                  }
                  aria-pressed={active}
                  className={`text-cell rounded-control flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left ${
                    active ? "bg-verdigris text-paper" : "text-paper hover:bg-paper/10"
                  } ${widget.hidden ? "opacity-50" : ""}`}
                >
                  <span
                    aria-hidden
                    className={`rounded-control h-3 w-3 shrink-0 ${TONE_SWATCH[toneOf(widget.config)]}`}
                  />
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

/*
 * The placeholders carry their label and tone in `config` — the widget's own
 * settings bag, exactly where a real widget's settings will live. So the
 * document these boxes produce already has the shape a real board has.
 *
 * The tones are drawn from the palette's neutrals plus the accent. Not --live,
 * --stale or --offline: those are status colours and never decorative, however
 * convenient five distinguishable swatches would be.
 */

export const TONES = ["ink", "ink-soft", "ink-faint", "verdigris", "verdigris-wash"] as const;
export type Tone = (typeof TONES)[number];

export const TONE_FILL: Record<Tone, string> = {
  ink: "bg-ink text-paper",
  "ink-soft": "bg-ink-soft text-paper",
  "ink-faint": "bg-ink-faint text-ink",
  verdigris: "bg-verdigris text-paper",
  "verdigris-wash": "bg-verdigris-wash text-ink",
};

const TONE_SWATCH: Record<Tone, string> = {
  ink: "bg-ink border-paper/15 border",
  "ink-soft": "bg-ink-soft",
  "ink-faint": "bg-ink-faint",
  verdigris: "bg-verdigris",
  "verdigris-wash": "bg-verdigris-wash",
};

export function toneOf(config: Record<string, unknown>): Tone {
  const tone = config.tone;
  return TONES.includes(tone as Tone) ? (tone as Tone) : "ink";
}

export function labelOf(config: Record<string, unknown>, fallback: string): string {
  return typeof config.label === "string" ? config.label : fallback.slice(0, 8);
}
