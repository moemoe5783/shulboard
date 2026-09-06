import { Button, type ButtonVariant } from "@/components/Button";
import { NavRail, type NavItem } from "@/components/NavRail";
import { Table, type Column } from "@/components/Table";

/*
 * The three primitives at realistic density: the rail, a table, and the buttons.
 * Placeholder data throughout — this is a reference sheet, not a view.
 *
 * A SERVER component, deliberately. Every real view is one, and a client
 * reference sheet exercises a different boundary than the thing it documents:
 * a server component may not hand a function to a client component, so a Table
 * that only ever rendered from a client page hid that it could not be used from
 * a server one.
 */

const NAV_ITEMS: NavItem[] = [
  { id: "screens", label: "Screens", href: "#", count: 4 },
  { id: "boards", label: "Boards", href: "#", count: 7 },
  { id: "media", label: "Media", href: "#" },
  { id: "people", label: "People", href: "#" },
  { id: "notices", label: "Notices", href: "#", count: 2 },
  { id: "schedules", label: "Schedules", href: "#" },
];

const NAV_FOOTER: NavItem[] = [{ id: "settings", label: "Settings", href: "#" }];

type Screen = {
  id: string;
  name: string;
  location: string;
  showing: string;
  status: "live" | "stale" | "offline";
  lastSeen: string;
  size: string;
};

const SCREENS: Screen[] = [
  {
    id: "lobby",
    name: "Main lobby",
    location: "Entrance, north wall",
    showing: "Weekday board",
    status: "live",
    lastSeen: "now",
    size: "1080p",
  },
  {
    id: "beis",
    name: "Beis medrash",
    location: "Front, above aron",
    showing: "Zmanim + notices",
    status: "live",
    lastSeen: "now",
    size: "1080p",
  },
  {
    id: "simcha",
    name: "Simcha hall",
    location: "East wall",
    showing: "Shabbos board",
    status: "stale",
    lastSeen: "3 days",
    size: "4K",
  },
  {
    id: "coat",
    name: "Social hall",
    location: "By the coat room",
    showing: "Weekday board",
    status: "offline",
    lastSeen: "Monday",
    size: "1080p",
  },
];

const DOT: Record<Screen["status"], string> = {
  live: "bg-live",
  stale: "bg-stale",
  offline: "bg-offline",
};

const SCREEN_COLUMNS: Column<Screen>[] = [
  {
    key: "screen",
    label: "Screen",
    cell: (screen) => (
      <div className="flex items-center gap-3">
        {/* 64×36. A real render of the board lands here once the widget renderer
            exists; it is deliberately an empty frame rather than an icon or a
            gradient stand-in. */}
        <span className="bg-paper border-rule rounded-control h-9 w-16 shrink-0 border" />
        <span className="min-w-0">
          <span className="block truncate">{screen.name}</span>
          <span className="text-min text-ink-soft block truncate">{screen.location}</span>
        </span>
      </div>
    ),
  },
  { key: "showing", label: "Showing", cell: (screen) => screen.showing },
  {
    key: "lastSeen",
    label: "Last seen",
    width: "w-44",
    // Plain language, so it stays in Assistant: "3 days", not "72h ago", and
    // never a badge pill.
    cell: (screen) => (
      <span className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[screen.status]}`} />
        <span>{screen.lastSeen}</span>
      </span>
    ),
  },
  { key: "size", label: "Size", width: "w-24", cell: (screen) => screen.size },
];

type Minyan = { id: string; name: string; weekday: string; shabbos: string };

const MINYANIM: Minyan[] = [
  { id: "shacharis", name: "Shacharis", weekday: "07:00", shabbos: "09:00" },
  { id: "daf", name: "Daf yomi", weekday: "06:15", shabbos: "07:45" },
  { id: "mincha", name: "Mincha", weekday: "13:45", shabbos: "13:30" },
  { id: "maariv", name: "Maariv", weekday: "20:15", shabbos: "20:40" },
];

const MINYAN_COLUMNS: Column<Minyan>[] = [
  { key: "name", label: "Minyan", cell: (minyan) => minyan.name },
  { key: "weekday", label: "Weekday", kind: "time", width: "w-40", cell: (m) => m.weekday },
  { key: "shabbos", label: "Shabbos", kind: "time", width: "w-40", cell: (m) => m.shabbos },
];

type Notice = { id: string; title: string; until: string };

const NOTICE_COLUMNS: Column<Notice>[] = [
  { key: "title", label: "Notice", cell: (notice) => notice.title },
  { key: "until", label: "Until", width: "w-40", cell: (notice) => notice.until },
];

type ButtonSpec = { id: ButtonVariant; label: string; use: string };

const BUTTON_SPECS: ButtonSpec[] = [
  { id: "primary", label: "Add screen", use: "The one action a view is for" },
  { id: "secondary", label: "Rotate token", use: "Everything else with a border" },
  { id: "tertiary", label: "Cancel", use: "Dismissals and inline actions" },
];

const BUTTON_COLUMNS: Column<ButtonSpec>[] = [
  { key: "variant", label: "Variant", width: "w-40", cell: (spec) => spec.id },
  {
    key: "button",
    label: "Default",
    width: "w-48",
    cell: (spec) =>
      spec.id === "primary" ? (
        // Not a second verdigris fill. The header action above is this sheet's
        // primary specimen, which keeps the page to one and demonstrates the
        // rule by construction rather than by a footnote.
        <span className="text-ink-soft">Add screen, in the header</span>
      ) : (
        <Button variant={spec.id}>{spec.label}</Button>
      ),
  },
  {
    key: "disabled",
    label: "Disabled",
    width: "w-48",
    cell: (spec) => (
      <Button variant={spec.id} disabled>
        {spec.label}
      </Button>
    ),
  },
  { key: "use", label: "When to use it", cell: (spec) => spec.use },
];

/**
 * A ruled section inside the single content pane. Deliberately not a card: the
 * shell in design.md §4 has one content pane per view, and hierarchy inside it
 * comes from rule weight.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-rule-firm border-t first:border-t-0">
      <h2 className="text-heading px-5 pt-5 pb-3">{title}</h2>
      {children}
    </section>
  );
}

export default function PrimitivesPage() {
  return (
    <div className="bg-paper font-ui flex min-h-screen">
      <NavRail
        orgs={[{ id: "demo", name: "Beis Menachem" }]}
        activeOrgId="demo"
        items={NAV_ITEMS}
        footerItems={NAV_FOOTER}
        activeId="screens"
      />

      <div className="min-w-0 flex-1 px-6 py-6">
        <div className="mx-auto max-w-360">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-title">Screens</h1>
              <p className="text-body text-ink-soft mt-1">
                The rail, the table and the buttons at real density. Placeholder
                data — the davening and button sections below are reference, not
                part of this view.
              </p>
            </div>
            <Button variant="primary">Add screen</Button>
          </div>

          <div className="rounded-panel border-rule bg-surface mt-6 border pb-5">

          <Section title="Every screen in the building">
            <Table
              caption="Screens, what each is showing, and when it last checked in"
              columns={SCREEN_COLUMNS}
              rows={SCREENS}
              rowKey={(screen) => screen.id}
              empty={{
                title: "Add your first screen",
                description:
                  "Each screen gets its own link you open on the TV or display device.",
                action: <Button variant="secondary">Add screen</Button>,
              }}
            />
          </Section>

          <Section title="Davening times">
            <Table
              caption="Weekday and Shabbos times for each minyan"
              columns={MINYAN_COLUMNS}
              rows={MINYANIM}
              rowKey={(minyan) => minyan.id}
              empty={{
                title: "Add a minyan",
                description:
                  "Davening times show on any board carrying the davening widget.",
                action: <Button variant="secondary">Add minyan</Button>,
              }}
            />
          </Section>

          <Section title="Notices">
            <p className="text-body text-ink-soft max-w-prose px-5 pb-4">
              An empty table is an instruction, not a mood. In a real notices view
              the button below is that view&rsquo;s primary; here it is secondary
              so the sheet keeps to one.
            </p>
            <Table
              caption="Notices, none yet"
              columns={NOTICE_COLUMNS}
              rows={[]}
              rowKey={(notice) => notice.id}
              empty={{
                title: "Add your first notice",
                description:
                  "Notices show on every board that carries the notices widget, and come down on the date you set.",
                action: <Button variant="secondary">Add notice</Button>,
              }}
            />
          </Section>

          <Section title="Buttons">
            <p className="text-body text-ink-soft max-w-prose px-5 pb-4">
              A view gets one primary and no more, so this sheet has exactly one:
              the header action. The primary row below points at it rather than
              painting a second verdigris button.
            </p>
            <Table
              caption="Button variants, their disabled states, and when to use each"
              columns={BUTTON_COLUMNS}
              rows={BUTTON_SPECS}
              rowKey={(spec) => spec.id}
              empty={{
                title: "No variants",
                description: "There are three, so this never renders.",
              }}
            />
          </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
