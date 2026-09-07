"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Table, type Column } from "@/components/Table";
import { buttonClassName } from "@/components/Button";
import { renameBoard } from "./actions";

/*
 * The wall of boards — a table, not a grid of identical cards (design.md §5:
 * a list of records is a table, not a bounded object).
 */

export type BoardRow = {
  id: string;
  name: string;
  size: string;
};

const MENU_ITEM =
  "text-cell rounded-control text-ink hover:bg-verdigris-wash/40 " +
  "flex h-8 w-full items-center px-2 text-left";

const RENAME_INPUT =
  "text-body rounded-control border-rule text-ink bg-surface h-8 w-full max-w-64 border px-2";

/**
 * The name cell, and the row's one editable field.
 *
 * A plain form rather than a scripted submit: Next's own guidance for calling
 * a Server Action from a form needs nothing beyond the form itself, so there
 * is no reason to reach for a transition here the way the editor's autosave
 * (a useEffect, not a form) has to.
 */
function NameCell({
  board,
  renaming,
  onDone,
}: {
  board: BoardRow;
  renaming: boolean;
  onDone: () => void;
}) {
  if (!renaming) {
    return <span className="block truncate">{board.name}</span>;
  }

  return (
    <form action={renameBoard.bind(null, board.id)} onPointerDown={(e) => e.stopPropagation()}>
      <input
        name="name"
        defaultValue={board.name}
        maxLength={120}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          event.currentTarget.form?.requestSubmit();
          onDone();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.form?.requestSubmit();
            onDone();
          }
          if (event.key === "Escape") onDone();
        }}
        className={RENAME_INPUT}
      />
    </form>
  );
}

function RowMenu({
  board,
  open,
  onOpenChange,
  onRename,
}: {
  board: BoardRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
}) {
  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="relative inline-block text-left"
    >
      <summary className="text-cell rounded-control text-ink-soft hover:bg-verdigris-wash/40 flex h-8 w-8 cursor-pointer list-none items-center justify-center">
        <span className="sr-only">More for {board.name}</span>
        <span aria-hidden>⋯</span>
      </summary>
      <div className="rounded-panel border-rule bg-surface absolute top-9 right-0 z-10 w-44 border p-1 shadow-menu">
        <ul className="flex flex-col">
          <li>
            <Link href={`/boards/${board.id}`} className={MENU_ITEM}>
              Open
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onRename();
              }}
              className={MENU_ITEM}
            >
              Rename
            </button>
          </li>
        </ul>
      </div>
    </details>
  );
}

export function BoardsTable({ rows }: { rows: BoardRow[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  useEffect(() => {
    if (!openId) return;
    const close = () => setOpenId(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openId]);

  const columns: Column<BoardRow>[] = [
    {
      key: "name",
      label: "Board",
      cell: (board) => (
        <NameCell
          board={board}
          renaming={renamingId === board.id}
          onDone={() => setRenamingId(null)}
        />
      ),
    },
    {
      key: "size",
      label: "Size",
      width: "w-36",
      cell: (board) => <span className="numeric">{board.size}</span>,
    },
  ];

  return (
    <Table
      caption="Every board in this shul, and how big it's designed for"
      columns={columns}
      rows={rows}
      rowKey={(board) => board.id}
      onRowClick={(board) => {
        if (renamingId !== board.id) router.push(`/boards/${board.id}`);
      }}
      rowAction={(board) => (
        <span onPointerDown={(event) => event.stopPropagation()}>
          <RowMenu
            board={board}
            open={openId === board.id}
            onOpenChange={(next) => setOpenId(next ? board.id : null)}
            onRename={() => setRenamingId(board.id)}
          />
        </span>
      )}
      empty={{
        title: "Add your first board",
        description: "A board is the design a screen shows — start with one and put it on a screen.",
        action: (
          <Link href="/boards/new" className={buttonClassName("primary")}>
            Add board
          </Link>
        ),
      }}
    />
  );
}
