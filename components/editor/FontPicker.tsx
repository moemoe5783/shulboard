"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { PANEL_LABEL } from "./panelControls";

/*
 * A font list where every name is drawn IN ITS OWN FONT — the sample is the
 * name. A native <select> can't do this: its options are painted by the
 * operating system, which ignores font-family on most platforms. So this is a
 * listbox in a popover, with the keyboard a select has (arrows, Home/End,
 * Enter, Escape, type a letter to jump).
 *
 * LOADS ONLY WHAT'S SEEN. Setting a font-family is what makes the browser
 * fetch that face (every face is declared up front and costs nothing until
 * then — lib/fonts), so each row names its family only once it has scrolled
 * into view (IntersectionObserver), and keeps it after. Opening the list
 * fetches a screenful of faces, not the catalog. Rows are one fixed height, so
 * a face arriving never shifts the list under the pointer.
 *
 * A face with Hebrew shows its Hebrew name beside the English, both in that
 * face. One that draws capitals only says so.
 *
 * The popover floats, so it has the panel's one kind of shadow (design.md §3).
 */

export type FontOption = {
  value: string;
  /** The name as shown — drawn in `family` when there is one. */
  name: string;
  /** The CSS font-family to draw this row in; none for the UI's own face
   *  ("Board default", "Auto (matched)"). */
  family?: string;
  /** The Hebrew name, shown beside the English in the same face. */
  hebrewName?: string;
  capsOnly?: boolean;
  /** A short line after the name, in the UI face. */
  note?: string;
  /** Draw the name in the UI face, small — for a Hebrew font, whose Hebrew
   *  name (in the face) is the big one and the English only identifies it. */
  nameInUi?: boolean;
  /** A sample line in the face, under the name. */
  sample?: string;
  /** A Hebrew sample line in the face, beside `sample`. */
  hebrewSample?: string;
};

export type FontGroup = { label?: string; options: readonly FontOption[] };

/** One height for every row, one line or two, so a face arriving never moves
 *  the list under the pointer. */
const ROW_HEIGHT = 54;
/** What a face's name falls back to until its file arrives: the UI's own. */
const UI_FALLBACK = "var(--type-ui)";
const LIST_MAX_HEIGHT = 360;

export function FontPicker({
  label,
  value,
  groups,
  onChange,
  onPreview,
}: {
  label: string;
  value: string;
  groups: readonly FontGroup[];
  onChange: (value: string) => void;
  /** A font hovered (its value), or none — the canvas shows it without
   *  changing anything (lib/editor/store.ts, fontPreview). */
  onPreview?: (value: string | null) => void;
}) {
  const [open, setOpen] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const flat = groups.flatMap((group) => group.options);

  // A preview never outlives the list: gone with it if the picker unmounts
  // while open (the selection changed under it).
  const previewRef = useRef(onPreview);
  useEffect(() => {
    previewRef.current = onPreview;
  });
  const wasOpen = useRef(false);
  useEffect(() => {
    wasOpen.current = open !== null;
  }, [open]);
  useEffect(() => () => {
    if (wasOpen.current) previewRef.current?.(null);
  }, []);
  const selectedIndex = flat.findIndex((option) => option.value === value);
  const selected = flat[selectedIndex];

  const close = (refocus = true) => {
    onPreview?.(null);
    setOpen(null);
    if (refocus) buttonRef.current?.focus();
  };

  const toggle = () => {
    if (open) return close();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 240);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const wanted = Math.min(LIST_MAX_HEIGHT, flat.length * ROW_HEIGHT + 8);
    setActive(Math.max(0, selectedIndex));
    // Below when it fits (or has more room than above); never past the window.
    setOpen(
      below >= wanted || below >= above
        ? { left, width, top: rect.bottom + 4, maxHeight: Math.min(wanted, below) }
        : { left, width, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(wanted, above) },
    );
  };

  // Close on a click outside, or the panel scrolling out from under it.
  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      previewRef.current?.(null);
      setOpen(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) dismiss();
    };
    const onScroll = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Opened: focus the list with the chosen font in view.
  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    listRef.current?.querySelector(`[data-index="${Math.max(0, selectedIndex)}"]`)?.scrollIntoView({ block: "center" });
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open !== null]);

  const move = (index: number) => {
    const next = Math.max(0, Math.min(flat.length - 1, index));
    setActive(next);
    listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const choose = (index: number) => {
    const option = flat[index];
    if (option) onChange(option.value);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") move(active + 1);
    else if (event.key === "ArrowUp") move(active - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(flat.length - 1);
    else if (event.key === "PageDown") move(active + 8);
    else if (event.key === "PageUp") move(active - 8);
    else if (event.key === "Enter" || event.key === " ") choose(active);
    else if (event.key === "Escape" || event.key === "Tab") close(event.key === "Escape");
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      // Type a letter: the next font starting with it.
      const letter = event.key.toLowerCase();
      const order = [...flat.keys()].map((i) => (active + 1 + i) % flat.length);
      const hit = order.find((i) => flat[i].name.toLowerCase().startsWith(letter));
      if (hit !== undefined) move(hit);
      else return;
    } else return;
    // Handled here: not a nudge, a deselect or an undo on the canvas behind.
    event.preventDefault();
    event.stopPropagation();
  };

  const listId = `font-list-${label.replace(/\W+/g, "-").toLowerCase()}`;
  // Where each group's rows start in the flat list.
  const starts = groups.map((_, g) => groups.slice(0, g).reduce((n, group) => n + group.options.length, 0));

  return (
    <div ref={rootRef} className="flex flex-col gap-1" data-font-picker>
      <span className={PANEL_LABEL} id={`${listId}-label`}>
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            toggle();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open !== null}
        aria-labelledby={`${listId}-label ${listId}-value`}
        className="text-cell rounded-control text-paper border-paper/20 bg-ink hover:border-paper/40 flex h-8 w-full items-center gap-2 border px-2 text-left"
      >
        <span
          id={`${listId}-value`}
          className="min-w-0 flex-1 truncate text-[16px] leading-none"
          style={selected?.family ? { fontFamily: selected.family } : undefined}
        >
          {selected?.name ?? value}
        </span>
        <svg aria-hidden viewBox="0 0 10 6" className="size-2.5 shrink-0 opacity-70">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${listId}-label`}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onKeyDown}
          className="bg-ink border-paper/20 fixed z-50 overflow-y-auto rounded-[6px] border py-1 shadow-lg outline-none"
          style={{ left: open.left, top: open.top, bottom: open.bottom, width: open.width, maxHeight: open.maxHeight }}
          onPointerLeave={() => onPreview?.(null)}
          data-font-list
        >
          {groups.map((group, g) => (
            <div key={group.label ?? `group-${g}`} role="group" aria-label={group.label}>
              {group.label && <div className="text-meta text-paper/50 px-2 pt-2 pb-1">{group.label}</div>}
              {group.options.map((option, o) => {
                const i = starts[g] + o;
                return (
                  <FontRow
                    key={option.value}
                    id={`${listId}-${i}`}
                    index={i}
                    option={option}
                    selected={option.value === value}
                    active={i === active}
                    root={listRef}
                    onHover={() => {
                      if (i !== active) setActive(i);
                    }}
                    onEnter={() => onPreview?.(option.value)}
                    onChoose={() => choose(i)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FontRow({
  id,
  index,
  option,
  selected,
  active,
  root,
  onHover,
  onEnter,
  onChoose,
}: {
  id: string;
  index: number;
  option: FontOption;
  selected: boolean;
  active: boolean;
  root: React.RefObject<HTMLDivElement | null>;
  onHover: () => void;
  onEnter: () => void;
  onChoose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  // Name the face only once the row is on screen — that's what fetches it.
  useEffect(() => {
    if (seen || !option.family) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setSeen(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { root: root.current, rootMargin: `${ROW_HEIGHT * 2}px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen, option.family, root]);

  // In the face once its row has been seen; the UI face until its file lands.
  const face: CSSProperties | undefined = option.family && seen ? { fontFamily: `${option.family}, ${UI_FALLBACK}` } : undefined;
  const caps = option.capsOnly ? { textTransform: "uppercase" as const } : undefined;

  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      data-index={index}
      data-font-option={option.value}
      onPointerMove={onHover}
      onPointerEnter={onEnter}
      onClick={onChoose}
      className={`text-paper flex cursor-default flex-col justify-center gap-1 px-2 ${active ? "bg-paper/10" : ""} ${
        selected ? "text-paper" : "text-paper/90"
      }`}
      style={{ height: ROW_HEIGHT }}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          className={`min-w-0 truncate leading-tight ${option.family && !option.nameInUi ? "text-[18px]" : "text-cell"}`}
          style={option.nameInUi ? undefined : face}
          data-font-sample
        >
          {option.name}
        </span>
        {option.capsOnly && <span className="text-meta text-paper/50 shrink-0">capitals only</span>}
        {option.note && <span className="text-meta text-paper/50 min-w-0 truncate">{option.note}</span>}
        {option.hebrewName && (
          <span dir="rtl" lang="he" className="ml-auto shrink-0 text-[18px] leading-tight" style={face} data-font-hebrew-name>
            {option.hebrewName}
          </span>
        )}
        {selected && !option.hebrewName && (
          <svg aria-hidden viewBox="0 0 12 10" className="text-paper/70 ml-auto size-3 shrink-0 self-center">
            <path d="M1 5l3.5 3.5L11 1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        )}
      </div>
      {(option.sample || option.hebrewSample) && (
        <div className="text-paper/70 flex min-w-0 items-baseline gap-2 text-[14px] leading-tight">
          {option.sample && (
            <span className="min-w-0 truncate" style={{ ...face, ...caps }} data-font-latin-sample>
              {option.sample}
            </span>
          )}
          {option.hebrewSample && (
            <span dir="rtl" lang="he" className="ml-auto shrink-0" style={face} data-font-hebrew-sample>
              {option.hebrewSample}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
