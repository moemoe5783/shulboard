/*
 * Left navigation rail — docs/design.md §4.
 *
 * 216px fixed, sitting on --paper. There is no border against the content pane:
 * the surface change from --paper to --surface does that work.
 *
 * The active item gets --verdigris-wash behind --verdigris text and no left
 * accent bar.
 */

export type NavItem = {
  id: string;
  label: string;
  href: string;
  /** Right-aligned in the rail. Information, not decoration. */
  count?: number;
};

export type NavRailProps = {
  orgName: string;
  items: NavItem[];
  /** Rendered at the bottom of the rail, away from the content nav. */
  footerItems?: NavItem[];
  activeId: string;
};

function Item({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li>
      <a
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`text-cell rounded-control flex h-8 items-center gap-2 px-2 ${
          active
            ? "bg-verdigris-wash text-verdigris"
            : "text-ink hover:bg-verdigris-wash/40"
        }`}
      >
        <span className="min-w-0 truncate">{item.label}</span>
        {item.count !== undefined && (
          // 13px --ink-soft on the active item too: the count is information
          // about the section, not part of the selected state.
          <span className="text-meta text-ink-soft numeric ml-auto">{item.count}</span>
        )}
      </a>
    </li>
  );
}

export function NavRail({ orgName, items, footerItems = [], activeId }: NavRailProps) {
  return (
    <nav aria-label="Sections" className="bg-paper flex w-54 shrink-0 flex-col px-3 py-4">
      <button
        type="button"
        className="text-body rounded-control mb-4 flex h-8 items-center gap-1 px-2 text-left font-semibold"
      >
        <span className="min-w-0 truncate">{orgName}</span>
        <span aria-hidden className="text-ink-soft">
          ▾
        </span>
      </button>

      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <Item key={item.id} item={item} active={item.id === activeId} />
        ))}
      </ul>

      {footerItems.length > 0 && (
        <ul className="mt-auto flex flex-col gap-0.5 pt-6">
          {footerItems.map((item) => (
            <Item key={item.id} item={item} active={item.id === activeId} />
          ))}
        </ul>
      )}
    </nav>
  );
}
