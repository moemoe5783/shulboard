"use client";

import type { ReactNode } from "react";

/*
 * Table — docs/design.md §5.
 *
 * A real <table>. One hairline, under the header row. No zebra striping, no
 * borders between columns, no rounded corners on rows. 40px rows.
 *
 * Hover is a background shift to --verdigris-wash at 40% and nothing else: no
 * lift, no scale, no shadow, no transition.
 */

export type ColumnKind =
  /** Labels, names, and prose — including prose that contains a number. */
  | "text"
  /**
   * A column of clock times. Set in Frank Ruhl Libre, which has tabular figures.
   * Assistant has none, so times set in it drift by ~3px across five figures and
   * will not line up down a column. See docs/design.md §3.
   */
  | "time";

export type Column<Row> = {
  key: string;
  label: string;
  kind?: ColumnKind;
  align?: "left" | "right";
  /** A Tailwind width utility, e.g. "w-40". Omit to let the column size itself. */
  width?: string;
  cell: (row: Row) => ReactNode;
};

/**
 * What to show when there are no rows.
 *
 * Required, not optional. An empty state is an instruction, not a mood: a
 * heading that names the space, one sentence explaining it, one button. Making
 * this required is what stops a table shipping as a header rule over blank
 * space.
 */
export type EmptyState = {
  title: string;
  description: string;
  action?: ReactNode;
};

export type TableProps<Row> = {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  empty: EmptyState;
  /** Describes the table for screen readers. Not rendered. */
  caption: string;
};

// px-5 rather than a padded wrapper, so the hover background spans the full row.
const CELL = "px-5 align-middle";

export function Table<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  caption,
}: TableProps<Row>) {
  const interactive = Boolean(onRowClick);

  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-rule-firm border-b">
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={`text-meta text-ink-soft h-8 font-regular ${CELL} ${
                column.align === "right" ? "text-right" : "text-left"
              } ${column.width ?? ""}`}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="px-5 py-8">
              <h3 className="text-heading">{empty.title}</h3>
              <p className="text-body text-ink-soft mt-1 max-w-prose">
                {empty.description}
              </p>
              {empty.action && <div className="mt-4">{empty.action}</div>}
            </td>
          </tr>
        )}
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            className={`hover:bg-verdigris-wash/40 h-10 ${
              interactive ? "cursor-pointer" : ""
            }`}
            // A clickable row needs a keyboard path. The people using this are
            // often 50+ on a desktop, and a mouse-only row is simply unreachable
            // for anyone tabbing through the page.
            tabIndex={interactive ? 0 : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            onKeyDown={
              onRowClick
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  }
                : undefined
            }
          >
            {columns.map((column) => (
              <td
                key={column.key}
                className={`text-cell ${CELL} ${
                  column.align === "right" ? "text-right" : "text-left"
                } ${column.kind === "time" ? "font-sefarim numeric" : ""}`}
              >
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
