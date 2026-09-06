"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Table, type Column } from "@/components/Table";
import { buttonClassName } from "@/components/Button";
import type { ScreenStatus } from "@/lib/screens";

/*
 * The wall of screens.
 *
 * A client component for two reasons: row click opens the detail, and the row
 * menu copies a link — both are functions, and a server component cannot hand
 * one across the boundary. The page does the querying and the formatting, so
 * nothing here depends on the clock and there is no hydration seam.
 */

export type ScreenRow = {
  id: string;
  name: string;
  location: string | null;
  showing: string;
  status: ScreenStatus;
  lastSeen: string;
  size: string;
  /** The display link, built on the server against the host being viewed. */
  url: string;
};

const DOT: Record<ScreenStatus, string> = {
  live: "bg-live",
  stale: "bg-stale",
  offline: "bg-offline",
};

const STATUS_LABEL: Record<ScreenStatus, string> = {
  live: "Live",
  stale: "Not checked in recently",
  offline: "Offline",
};

const COLUMNS: Column<ScreenRow>[] = [
  {
    key: "screen",
    label: "Screen",
    cell: (screen) => (
      <div className="flex items-center gap-3">
        {/* 64×36, and deliberately empty. design.md §4 wants a real render of
            the board through the shared widget renderer; that renderer does not
            exist yet, and a gradient or an icon standing in for it would be a
            lie about what the product can do. An empty frame is honest and
            holds the row geometry. */}
        <span className="bg-paper border-rule rounded-control h-9 w-16 shrink-0 border" />
        <span className="min-w-0">
          <span className="block truncate">{screen.name}</span>
          {screen.location && (
            <span className="text-min text-ink-soft block truncate">{screen.location}</span>
          )}
        </span>
      </div>
    ),
  },
  { key: "showing", label: "Showing", cell: (screen) => screen.showing },
  {
    key: "lastSeen",
    label: "Last seen",
    width: "w-44",
    // Plain language, so it stays in Assistant — "3 days", not "72h ago". The
    // numeric utility is a no-op on that face today and correct anyway; it
    // starts working the day the chrome face gains tnum. See design.md §3.
    cell: (screen) => (
      <span className="numeric flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[screen.status]}`}
          role="img"
          aria-label={STATUS_LABEL[screen.status]}
        />
        <span>{screen.lastSeen}</span>
      </span>
    ),
  },
  {
    key: "size",
    label: "Size",
    width: "w-36",
    cell: (screen) => <span className="numeric">{screen.size}</span>,
  },
];

// The same geometry as the org switcher's menu rows, so every menu in the
// product has one shape.
const MENU_ITEM =
  "text-cell rounded-control text-ink hover:bg-verdigris-wash/40 " +
  "flex h-8 w-full items-center px-2 text-left";

/**
 * The quiet overflow menu design.md §4 asks for at the right of each row.
 *
 * A <details> disclosure, like the org switcher: keyboard operable and closed by
 * Escape without any script. Which one is open is held here rather than by the
 * browser so that opening a second row closes the first, and so a click anywhere
 * else puts them all away.
 */
function RowMenu({
  screen,
  open,
  onOpenChange,
}: {
  screen: ScreenRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  async function copy() {
    onOpenChange(false);
    try {
      await navigator.clipboard.writeText(screen.url);
    } catch {
      window.prompt("Copy the link:", screen.url);
    }
  }

  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="relative inline-block text-left"
    >
      <summary className="text-cell rounded-control text-ink-soft hover:bg-verdigris-wash/40 flex h-8 w-8 cursor-pointer list-none items-center justify-center">
        <span className="sr-only">More for {screen.name}</span>
        <span aria-hidden>⋯</span>
      </summary>
      {/* A menu genuinely floats, so this is one of the few things in the
          product allowed a shadow. */}
      <div className="rounded-panel border-rule bg-surface absolute top-9 right-0 z-10 w-44 border p-1 shadow-menu">
        <ul className="flex flex-col">
          <li>
            <Link href={`/screens/${screen.id}`} className={MENU_ITEM}>
              Open
            </Link>
          </li>
          <li>
            <button type="button" onClick={copy} className={MENU_ITEM}>
              Copy display link
            </button>
          </li>
        </ul>
      </div>
    </details>
  );
}

export function ScreensTable({ rows }: { rows: ScreenRow[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);

  // A <details> does not close when you click past it, and a menu left hanging
  // over the next row is worse than no menu.
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

  return (
    <Table
      caption="Every screen in this shul, what it is showing, and when it last checked in"
      columns={COLUMNS}
      rows={rows}
      rowKey={(screen) => screen.id}
      onRowClick={(screen) => router.push(`/screens/${screen.id}`)}
      rowAction={(screen) => (
        // The pointerdown listener above would close this menu in the same
        // gesture that opens it, so the one inside the menu stops there.
        <span onPointerDown={(event) => event.stopPropagation()}>
          <RowMenu
            screen={screen}
            open={openId === screen.id}
            onOpenChange={(next) => setOpenId(next ? screen.id : null)}
          />
        </span>
      )}
      empty={{
        title: "Add your first screen",
        description: "Each screen gets its own link you open on the TV or display device.",
        action: (
          <Link href="/screens/new" className={buttonClassName("primary")}>
            Add screen
          </Link>
        ),
      }}
    />
  );
}
