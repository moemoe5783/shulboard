"use client";

import { useEffect, useRef, useState } from "react";
import { PALETTE } from "@/lib/board-palette";
import { PANEL_LABEL } from "./panelControls";

/*
 * Picking a colour for something on a board. A swatch opens a small popover
 * whose FIRST tab is a palette — families of shades a gabbai can click without
 * knowing what a hex code is — and whose second tab is the custom picker (the
 * browser's own colour sliders, plus a hex box for a colour someone was given).
 *
 * The popover floats, so it's the one place in the panel with a shadow
 * (design.md §3: shadows only on things that float). The colours themselves
 * are board content (lib/board-palette.ts) and may be anything.
 */

type Tab = "palette" | "custom";

const HEX = /^#[0-9a-f]{6}$/i;

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  /** A `#rrggbb` colour. */
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on a click outside, Escape, or the panel scrolling out from under it.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    const onScroll = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  /** Fixed to the viewport, not the panel, so a scrolling panel can't clip it;
   *  opens upward when there isn't room below. */
  const toggle = () => {
    if (open) return setOpen(null);
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
    const below = window.innerHeight - rect.bottom;
    setOpen(below >= POPOVER_HEIGHT + 12 ? { left, top: rect.bottom + 4 } : { left, bottom: window.innerHeight - rect.top + 4 });
  };

  return (
    <div ref={rootRef} className="relative" data-color-field>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open !== null}
        aria-label={`${label}: ${value}`}
        className="border-paper/20 hover:border-paper/40 flex h-8 items-center gap-2 rounded-[5px] border px-1.5"
      >
        <span className="border-paper/30 size-5 rounded-[4px] border" style={{ background: value }} />
        <span className="text-meta text-paper/80 numeric">{value}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="bg-ink border-paper/20 fixed z-50 rounded-[6px] border p-2 shadow-lg"
          style={{ left: open.left, top: open.top, bottom: open.bottom, width: POPOVER_WIDTH }}
        >
          <ColorPicker
            label={label}
            value={value}
            onChange={onChange}
            onPicked={() => setOpen(null)}
          />
        </div>
      )}
    </div>
  );
}

const POPOVER_WIDTH = 240;
const POPOVER_HEIGHT = 340;

/**
 * The picker itself — Palette first, Custom second — for the popover above and
 * for places that show it inline (the background field's Colour tab).
 */
export function ColorPicker({
  label,
  value,
  onChange,
  onPicked,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  /** Called after a palette click, e.g. to close a popover. */
  onPicked?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("palette");
  const [draft, setDraft] = useState(value);
  const normalized = value.toLowerCase();

  return (
    <div className="flex flex-col" data-color-picker>
      <div className="mb-2 flex gap-1" role="tablist">
        {(["palette", "custom"] as const).map((one) => (
          <button
            key={one}
            type="button"
            role="tab"
            aria-selected={tab === one}
            onClick={() => {
              setTab(one);
              setDraft(value);
            }}
            className={`text-meta flex-1 rounded-[5px] px-2 py-1 ${
              tab === one ? "bg-paper/15 text-paper" : "text-paper/60 hover:text-paper"
            }`}
          >
            {one === "palette" ? "Palette" : "Custom"}
          </button>
        ))}
      </div>

      {tab === "palette" ? (
        <div className="flex max-h-72 flex-col gap-1.5 overflow-auto pr-1" data-palette>
          {PALETTE.map((family) => (
            <div key={family.name} className="flex flex-col gap-0.5">
              <span className={PANEL_LABEL}>{family.name}</span>
              <div className="flex flex-wrap gap-1">
                {family.colors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={`${family.name} ${color}`}
                    aria-pressed={color.toLowerCase() === normalized}
                    onClick={() => {
                      onChange(color);
                      onPicked?.();
                    }}
                    className={`size-6 rounded-[4px] border ${
                      color.toLowerCase() === normalized ? "border-paper outline-paper outline-1" : "border-paper/20"
                    }`}
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            type="color"
            value={HEX.test(value) ? value : "#000000"}
            onChange={(event) => {
              onChange(event.target.value);
              setDraft(event.target.value);
            }}
            className="border-paper/20 h-24 w-full rounded-[5px] border bg-transparent"
            aria-label={`${label}, custom`}
          />
          <label className="flex items-center gap-2">
            <span className={PANEL_LABEL}>Hex</span>
            <input
              value={draft}
              onChange={(event) => {
                const next = event.target.value.trim();
                setDraft(next);
                const withHash = next.startsWith("#") ? next : `#${next}`;
                if (HEX.test(withHash)) onChange(withHash.toLowerCase());
              }}
              maxLength={7}
              spellCheck={false}
              className="text-cell text-paper border-paper/20 h-8 w-full rounded-[5px] border bg-transparent px-2"
            />
          </label>
        </div>
      )}
    </div>
  );
}
