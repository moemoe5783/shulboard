import type { ReactNode } from "react";

/*
 * Table — docs/design.md §5.
 *
 * A real <table>. One hairline, under the header row. No zebra striping, no
 * borders between columns, no rounded corners on rows. 40px rows.
 *
 * Hover is a background shift to --verdigris-wash at 40% and nothing else: no
 * lift, no scale, no shadow, no transition.
 *
 * NO "use client" HERE, ON PURPOSE.
 *
 * `cell` and `rowKey` are functions, and a server component may not hand a
 * function to a client component. Marking this file "use client" therefore made
 * the whole component unusable from a server page — which is every real view —
 * and the failure only appeared once a signed-in page tried to render.
 *
 * Without the directive this is a shared component: rendered on the server when
 * a server page imports it, where `cell` and `rowKey` are simply called during
 * render and never cross a boundary; bundled for the browser when a client page
 * imports it, where the row handlers below work as normal.
 *
 * The consequence to know about: `onRowClick` is a function too, so only a
 * client component can pass it. A server page gets a non-interactive table, and
 * the handlers below are `undefined` there, which is exactly what makes server
 * rendering legal.
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
  /**
   * A quiet overflow menu at the right of the row — docs/design.md §4. Rendered
   * in a column of its own, revealed on hover and whenever something inside it
   * has focus, so it is reachable by keyboard rather than mouse-only.
   *
   * It is opacity, not conditional rendering: the cell holds its width either
   * way, so nothing in the row shifts when the pointer arrives.
   */
  rowAction?: (row: Row) => ReactNode;
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
  rowAction,
  empty,
  caption,
}: TableProps<Row>) {
  const interactive = Boolean(onRowClick);
  const columnCount = columns.length + (rowAction ? 1 : 0);

  // A header rule over blank space is exactly the thing an empty state replaces,
  // so when there is nothing to list the column headers do not render either.
  if (rows.length === 0) {
    return (
      <table className="w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          <tr>
            <td colSpan={columnCount} className="px-5 py-8">
              <h3 className="text-heading">{empty.title}</h3>
              <p className="text-body text-ink-soft mt-1 max-w-prose">
                {empty.description}
              </p>
              {empty.action && <div className="mt-4">{empty.action}</div>}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

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
          {rowAction && (
            // No label. The column is the row's own menu, not a heading over a
            // set of values, and inventing one would put a word in the header
            // rule that names nothing.
            <th scope="col" className={`h-8 w-12 ${CELL}`}>
              <span className="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            className={`hover:bg-verdigris-wash/40 group h-10 ${
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
                    // Only the row itself. Without this, Enter on the overflow
                    // menu inside the row would open the row as well.
                    if (event.target !== event.currentTarget) return;
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
            {rowAction && (
              <td
                className={`text-cell w-12 text-right ${CELL}`}
                // The menu is inside a clickable row, so a click on it must not
                // also open the row. Attached only when the row is clickable,
                // because a handler is a function and a server-rendered table
                // cannot carry one.
                onClick={onRowClick ? (event) => event.stopPropagation() : undefined}
              >
                <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 has-[[open]]:opacity-100">
                  {rowAction(row)}
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
