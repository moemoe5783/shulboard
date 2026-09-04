import { NavRail, navRowClassName, type NavItem } from "@/components/NavRail";
import { getActiveOrg, getMemberships, requireUser } from "@/lib/orgs";
import { setActiveOrg, signOut } from "./actions";

/*
 * The authenticated shell. The rail, and the content area it sits beside.
 *
 * There is no org redirect here on purpose: org creation lives inside this route
 * group too, and a layout that redirected would redirect that page into itself.
 * Pages that cannot render without an org call requireActiveOrg().
 */

// Never prerendered, never cached across users: every page under this layout is
// scoped to one person's memberships.
export const dynamic = "force-dynamic";

const NAV_ITEMS: NavItem[] = [
  { id: "screens", label: "Screens", href: "/" },
  { id: "boards", label: "Boards", href: "/" },
  { id: "media", label: "Media", href: "/" },
  { id: "people", label: "People", href: "/" },
  { id: "notices", label: "Notices", href: "/" },
  { id: "schedules", label: "Schedules", href: "/" },
];

const NAV_FOOTER: NavItem[] = [{ id: "settings", label: "Settings", href: "/" }];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  const memberships = await getMemberships();
  const active = await getActiveOrg();

  // A brand new user has no shul and therefore nothing to navigate. Org creation
  // renders as a full page rather than beside an empty rail.
  if (memberships.length === 0 || !active) {
    return <div className="bg-paper font-ui min-h-screen">{children}</div>;
  }

  return (
    <div className="bg-paper font-ui flex min-h-screen">
      <NavRail
        orgs={memberships.map((membership) => ({
          id: membership.orgId,
          name: membership.name,
        }))}
        activeOrgId={active.orgId}
        switchAction={setActiveOrg}
        items={NAV_ITEMS}
        footerItems={NAV_FOOTER}
        activeId="screens"
        footer={
          // A rail row, not a button variant. Sign out is navigation-adjacent and
          // should not wear the accent that marks the active section.
          <form action={signOut}>
            <button type="submit" className={navRowClassName}>
              Sign out
            </button>
          </form>
        }
      />
      <div className="min-w-0 flex-1 px-6 py-6">
        <div className="mx-auto max-w-360">{children}</div>
      </div>
    </div>
  );
}
