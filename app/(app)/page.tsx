import { Table, type Column } from "@/components/Table";
import { requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";

/*
 * The authenticated landing.
 *
 * Deliberately not the screens view. It shows what this shul has so far, read
 * through RLS with the anon key like everything else — which also means it is a
 * live check that the policies let a member see their own org's rows and nothing
 * more.
 */

type Section = { id: string; label: string; count: number; description: string };

const SECTION_COLUMNS: Column<Section>[] = [
  { key: "label", label: "Section", width: "w-48", cell: (section) => section.label },
  {
    key: "count",
    label: "Set up",
    align: "right",
    width: "w-24",
    // A count, so it carries the numeric utility even though Assistant has no
    // tabular figures for it to act on.
    cell: (section) => <span className="numeric">{section.count}</span>,
  },
  {
    key: "description",
    label: "What it holds",
    cell: (section) => section.description,
  },
];

async function countRows(table: string, orgId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);

  if (error) throw new Error(`Could not count ${table}: ${error.message}`);
  return count ?? 0;
}

export default async function DashboardPage() {
  const org = await requireActiveOrg();

  const [screens, boards, notices, people] = await Promise.all([
    countRows("screens", org.orgId),
    countRows("boards", org.orgId),
    countRows("announcements", org.orgId),
    countRows("people", org.orgId),
  ]);

  const sections: Section[] = [
    {
      id: "screens",
      label: "Screens",
      count: screens,
      description: "Each one gets its own link you open on the TV",
    },
    {
      id: "boards",
      label: "Boards",
      count: boards,
      description: "The designs a screen rotates through",
    },
    {
      id: "notices",
      label: "Notices",
      count: notices,
      description: "Announcements, with a date they come down",
    },
    {
      id: "people",
      label: "People",
      count: people,
      description: "Birthdays and yahrzeits",
    },
  ];

  return (
    <>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-title">{org.name}</h1>
          <p className="text-body text-ink-soft mt-1">
            You&rsquo;re signed in as {org.role}. Times are set in {org.timezone}.
          </p>
        </div>
      </div>

      <div className="rounded-panel border-rule bg-surface mt-6 border pb-5">
        <section>
          <h2 className="text-heading px-5 pt-5 pb-3">What this shul has so far</h2>
          <Table
            caption="Each section of the dashboard and how much is set up"
            columns={SECTION_COLUMNS}
            rows={sections}
            rowKey={(section) => section.id}
            empty={{
              // Unreachable — the sections are a constant. Written as an
              // instruction anyway, because the next table to copy this will
              // have an empty state that a person actually sees.
              title: "The sections didn't load",
              description:
                "Reload the page. If it keeps happening the dashboard needs a redeploy.",
            }}
          />
        </section>
      </div>
    </>
  );
}
