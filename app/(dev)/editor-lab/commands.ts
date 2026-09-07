"use client";

import { useMemo } from "react";
import { useEditor } from "@/lib/editor/store";

/*
 * Every editing command in one list.
 *
 * §4b asks for a right-click menu "mirroring the above". Written twice, the menu
 * and the toolbar drift within a week — one grows a command the other lacks, or
 * they disagree about when something is available. So both read this, and
 * "mirroring" is structural rather than a promise.
 *
 * The keyboard shortcuts live here too, as text. The handler that implements
 * them is in EditorLab; this is what the menu shows, so a shortcut that stops
 * working is at least visibly claimed in one place.
 */

export type Command = {
  id: string;
  label: string;
  shortcut?: string;
  enabled: boolean;
  run: () => void;
};

export type CommandGroup = { id: string; commands: Command[] };

const isMac = () => typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform);

export function useCommands(): CommandGroup[] {
  const store = useEditor();
  const { selection, doc, history } = store;

  return useMemo(() => {
    const mod = isMac() ? "⌘" : "Ctrl";
    const some = selection.length > 0;
    const many = selection.length > 1;
    const three = selection.length > 2;

    const selected = doc.widgets.filter((w) => selection.includes(w.id));
    const anyLocked = selected.some((w) => w.locked);
    const inGroup = selected.some((w) => w.groupId !== null);

    return [
      {
        id: "history",
        commands: [
          {
            id: "undo",
            label: "Undo",
            shortcut: `${mod}Z`,
            enabled: history.past.length > 0,
            run: store.undo,
          },
          {
            id: "redo",
            label: "Redo",
            shortcut: `${mod}⇧Z`,
            enabled: history.future.length > 0,
            run: store.redo,
          },
        ],
      },
      {
        id: "clipboard",
        commands: [
          { id: "cut", label: "Cut", shortcut: `${mod}X`, enabled: some, run: store.cut },
          { id: "copy", label: "Copy", shortcut: `${mod}C`, enabled: some, run: store.copy },
          { id: "paste", label: "Paste", shortcut: `${mod}V`, enabled: true, run: store.paste },
          {
            id: "duplicate",
            label: "Duplicate",
            shortcut: `${mod}D`,
            enabled: some,
            run: () => store.duplicate(),
          },
          {
            id: "delete",
            label: "Delete",
            shortcut: "Del",
            enabled: some,
            run: () => store.remove(),
          },
        ],
      },
      {
        id: "order",
        commands: [
          {
            id: "front",
            label: "Bring to front",
            shortcut: `${mod}⇧]`,
            enabled: some,
            run: () => store.bringToFront(),
          },
          {
            id: "forward",
            label: "Bring forward",
            shortcut: `${mod}]`,
            enabled: some,
            run: () => store.bringForward(),
          },
          {
            id: "backward",
            label: "Send backward",
            shortcut: `${mod}[`,
            enabled: some,
            run: () => store.sendBackward(),
          },
          {
            id: "back",
            label: "Send to back",
            shortcut: `${mod}⇧[`,
            enabled: some,
            run: () => store.sendToBack(),
          },
        ],
      },
      {
        id: "grouping",
        commands: [
          {
            id: "group",
            label: "Group",
            shortcut: `${mod}G`,
            enabled: many,
            run: store.group,
          },
          {
            id: "ungroup",
            label: "Ungroup",
            shortcut: `${mod}⇧G`,
            enabled: inGroup,
            run: store.ungroup,
          },
        ],
      },
      {
        id: "state",
        commands: [
          {
            id: "lock",
            label: anyLocked ? "Unlock" : "Lock",
            enabled: some,
            run: () => store.setLocked(selection, !anyLocked),
          },
          {
            id: "hide",
            label: "Hide",
            enabled: some,
            run: () => store.setHidden(selection, true),
          },
        ],
      },
      {
        id: "align",
        commands: [
          { id: "align-left", label: "Align left", enabled: many, run: () => store.align("left") },
          {
            id: "align-hcenter",
            label: "Align centres",
            enabled: many,
            run: () => store.align("hcenter"),
          },
          { id: "align-right", label: "Align right", enabled: many, run: () => store.align("right") },
          { id: "align-top", label: "Align top", enabled: many, run: () => store.align("top") },
          {
            id: "align-vcenter",
            label: "Align middles",
            enabled: many,
            run: () => store.align("vcenter"),
          },
          {
            id: "align-bottom",
            label: "Align bottom",
            enabled: many,
            run: () => store.align("bottom"),
          },
          {
            id: "distribute-h",
            label: "Space evenly across",
            enabled: three,
            run: () => store.distribute("horizontal"),
          },
          {
            id: "distribute-v",
            label: "Space evenly down",
            enabled: three,
            run: () => store.distribute("vertical"),
          },
        ],
      },
    ];
  }, [store, selection, doc.widgets, history]);
}
