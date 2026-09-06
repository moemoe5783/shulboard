"use client";

import { useRouter } from "next/navigation";
import { Table, type Column } from "@/components/Table";
import type { ScreenStatus } from "@/lib/screens";

/*
 * The screens that need somebody to walk over and look at them.
 *
 * Client-side only because the rows open the screen detail, and a click handler
 * is a function. The page decides which screens belong here.
 */

export type AttentionRow = {
  id: string;
  name: string;
  location: string | null;
  status: ScreenStatus;
  lastSeen: string;
  /** What to do about it, in one line. */
  todo: string;
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

const COLUMNS: Column<AttentionRow>[] = [
  {
    key: "screen",
    label: "Screen",
    cell: (screen) => (
      <span className="min-w-0">
        <span className="block truncate">{screen.name}</span>
        {screen.location && (
          <span className="text-min text-ink-soft block truncate">{screen.location}</span>
        )}
      </span>
    ),
  },
  { key: "todo", label: "What to check", cell: (screen) => screen.todo },
  {
    key: "lastSeen",
    label: "Last seen",
    width: "w-44",
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
];

export function AttentionTable({
  rows,
  empty,
}: {
  rows: AttentionRow[];
  empty: { title: string; description: string; action?: React.ReactNode };
}) {
  const router = useRouter();

  return (
    <Table
      caption="Screens that have stopped checking in, and what to do about each"
      columns={COLUMNS}
      rows={rows}
      rowKey={(screen) => screen.id}
      onRowClick={(screen) => router.push(`/screens/${screen.id}`)}
      empty={empty}
    />
  );
}
