"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
  /**
   * The section exists in the product but has no view yet. Rendered as a
   * visibly inert row rather than a link that goes nowhere: a nav item that
   * navigates to the wrong place is a bug report waiting to happen, and hiding
   * it would make the rail lie about what the product is.
   */
  disabled?: boolean;
};

export type OrgOption = { id: string; name: string };

export type NavRailProps = {
  orgs: OrgOption[];
  activeOrgId: string;
  /**
   * Server action that switches org. Omit it and the org name renders as plain
   * text with no disclosure — which is what a reference sheet wants, and what a
   * user with one shul should arguably get too.
   */
  switchAction?: (formData: FormData) => Promise<void>;
  items: NavItem[];
  /** Rendered at the bottom of the rail, away from the content nav. */
  footerItems?: NavItem[];
  /** Rendered below the footer items. Sign out lives here. */
  footer?: ReactNode;
  /**
   * Which row is current. Normally left out — the rail reads the pathname, so
   * nothing has to remember to pass the right id from each page. Set it to pin
   * a row, which is what the reference sheet needs.
   */
  activeId?: string;
};

/**
 * The shape of a rail row, exported so anything else that belongs in the rail —
 * sign out, for instance — matches it exactly rather than approximating it with
 * a button variant that would put a stray accent in the navigation.
 */
export const navRowClassName =
  "text-cell rounded-control text-ink hover:bg-verdigris-wash/40 " +
  "flex h-8 w-full items-center px-2 text-left";

function ItemBody({ item }: { item: NavItem }) {
  return (
    <>
      <span className="min-w-0 truncate">{item.label}</span>
      {item.count !== undefined && (
        // 13px --ink-soft on the active item too: the count is information
        // about the section, not part of the selected state.
        <span className="text-meta text-ink-soft numeric ml-auto">{item.count}</span>
      )}
    </>
  );
}

function Item({ item, active }: { item: NavItem; active: boolean }) {
  if (item.disabled) {
    return (
      <li>
        <span
          aria-disabled="true"
          className="text-cell rounded-control text-ink-faint flex h-8 w-full items-center gap-2 px-2 text-left"
        >
          <ItemBody item={item} />
        </span>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={
          active
            ? "text-cell rounded-control bg-verdigris-wash text-verdigris flex h-8 w-full items-center gap-2 px-2 text-left"
            : `${navRowClassName} gap-2`
        }
      >
        <ItemBody item={item} />
      </Link>
    </li>
  );
}

/**
 * The org switcher.
 *
 * A <details> disclosure rather than a scripted menu: it is keyboard operable and
 * closes on Escape without any JavaScript, and switching org is a page
 * navigation anyway. The open panel is the one thing in the rail that genuinely
 * floats, so it is the one thing that gets a shadow.
 */
function OrgSwitcher({
  orgs,
  activeOrgId,
  switchAction,
}: {
  orgs: OrgOption[];
  activeOrgId: string;
  switchAction?: (formData: FormData) => Promise<void>;
}) {
  const active = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const name = active?.name ?? "No shul yet";

  if (!switchAction || orgs.length < 2) {
    return (
      <p className="text-body mb-4 flex h-8 items-center px-2 font-semibold">
        <span className="min-w-0 truncate">{name}</span>
      </p>
    );
  }

  return (
    <details className="relative mb-4">
      <summary className="text-body rounded-control flex h-8 cursor-pointer list-none items-center gap-1 px-2 font-semibold">
        <span className="min-w-0 truncate">{name}</span>
        <span aria-hidden className="text-ink-soft">
          ▾
        </span>
      </summary>
      <div className="rounded-panel border-rule bg-surface absolute top-9 right-0 left-0 z-10 border p-1 shadow-menu">
        <ul className="flex flex-col">
          {orgs.map((org) => (
            <li key={org.id}>
              <form action={switchAction}>
                <input type="hidden" name="orgId" value={org.id} />
                <button
                  type="submit"
                  className={`text-cell rounded-control hover:bg-verdigris-wash/40 flex h-8 w-full items-center px-2 text-left ${
                    org.id === activeOrgId ? "text-verdigris" : "text-ink"
                  }`}
                >
                  <span className="min-w-0 truncate">{org.name}</span>
                </button>
              </form>
            </li>
          ))}
          <li>
            {/* Plain ink, not the accent. Inside this menu verdigris already
                means "this is the shul you are in"; making the link verdigris
                too would have one colour carrying "you are here" and "do this"
                at the same time, a hand's width apart. */}
            <a href="/orgs/new" className={`${navRowClassName} border-rule mt-1 border-t`}>
              Add a shul
            </a>
          </li>
        </ul>
      </div>
    </details>
  );
}

/**
 * Which row the current URL belongs to.
 *
 * Longest matching href wins, so a future /screens/settings section would not
 * be swallowed by /screens. A disabled row never matches — it has no view for a
 * URL to be inside.
 */
function currentItemId(items: NavItem[], pathname: string | null): string | undefined {
  if (!pathname) return undefined;

  let best: NavItem | undefined;
  for (const item of items) {
    if (item.disabled) continue;
    const inside = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!inside) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best?.id;
}

export function NavRail({
  orgs,
  activeOrgId,
  switchAction,
  items,
  footerItems = [],
  footer,
  activeId,
}: NavRailProps) {
  const pathname = usePathname();
  const current = activeId ?? currentItemId([...items, ...footerItems], pathname);

  return (
    <nav aria-label="Sections" className="bg-paper flex w-54 shrink-0 flex-col px-3 py-4">
      <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} switchAction={switchAction} />

      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <Item key={item.id} item={item} active={item.id === current} />
        ))}
      </ul>

      {(footerItems.length > 0 || footer) && (
        <div className="mt-auto pt-6">
          <ul className="flex flex-col gap-0.5">
            {footerItems.map((item) => (
              <Item key={item.id} item={item} active={item.id === current} />
            ))}
          </ul>
          {footer}
        </div>
      )}
    </nav>
  );
}
