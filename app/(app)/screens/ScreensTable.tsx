"use client";

import { useRouter } from "next/navigation";
import { Table, type Column } from "@/components/Table";
import Link from "next/link";
import { buttonClassName } from "@/components/Button";
import type { ScreenStatus } from "@/lib/screens";

/*
 * The wall of screens.
 *
 * A client component for one reason: row click opens the detail, and onRowClick
 * is a function — a server component cannot hand one across the boundary. The
 * page does the querying and the formatting; this only renders and navigates,
 * so nothing here depends on the clock and there is no hydration seam.
 */

export type ScreenRow = {
  id: string;
  name: string;
  location: string | null;
  showing: string;
  status: ScreenStatus;
  lastSeen: string;
  size: string;
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
    cell: (screen) => (
      <span className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[screen.status]}`}
          role="img"
          aria-label={STATUS_LABEL[screen.status]}
        />
        <span>{screen.lastSeen}</span>
      </span>
    ),
  },
  { key: "size", label: "Size", width: "w-36", cell: (screen) => screen.size },
];

export function ScreensTable({ rows }: { rows: ScreenRow[] }) {
  const router = useRouter();

  return (
    <Table
      caption="Every screen in this shul, what it is showing, and when it last checked in"
      columns={COLUMNS}
      rows={rows}
      rowKey={(screen) => screen.id}
      onRowClick={(screen) => router.push(`/screens/${screen.id}`)}
      empty={{
        title: "Add your first screen",
        description:
          "Each screen gets its own link you open on the TV or display device.",
        action: (
          <Link href="/screens/new" className={buttonClassName("primary")}>
            Add screen
          </Link>
        ),
      }}
    />
  );
}
