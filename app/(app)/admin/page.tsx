import Link from "next/link";
import { Table } from "@/components/Table";
import { formatBytes, planLabel, requirePlatformAdmin, shortDate } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import { AdminTabs } from "./AdminTabs";

/*
 * The platform admin's view of every shul: its plan, screens, people and the
 * storage its photos take. One table (design.md §5, tables for lists); a row's
 * name opens that shul's page, where the plan is changed.
 */

export const dynamic = "force-dynamic";

export default async function AdminShulsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_orgs");
  if (error) throw new Error(`Couldn't load the shuls: ${error.message}`);
  const shuls = (data ?? []).filter((shul) => !shul.deleted_at);
  type Shul = (typeof shuls)[number];

  const screens = shuls.reduce((sum, shul) => sum + Number(shul.screen_count), 0);
  const live = shuls.reduce((sum, shul) => sum + Number(shul.screens_live), 0);
  const storage = shuls.reduce((sum, shul) => sum + Number(shul.storage_bytes), 0);
  const byPlan = (plan: string) => shuls.filter((shul) => shul.plan === plan).length;

  return (
    <div className="max-w-6xl">
      <h1 className="text-title">Platform admin</h1>
      <AdminTabs />
      <p className="text-body text-ink-soft mt-4" data-admin-summary>
        {shuls.length} {shuls.length === 1 ? "shul" : "shuls"}: {byPlan("trial")} on a free trial, {byPlan("basic")} on
        Basic, {byPlan("pro")} on Pro. {screens} {screens === 1 ? "screen" : "screens"}, {live} live now, and{" "}
        {formatBytes(storage)} of photos stored.
      </p>

      <section className="rounded-panel border-rule bg-surface mt-6 overflow-x-auto border">
        <Table<Shul>
          caption="Every shul"
          rows={shuls}
          rowKey={(shul) => shul.org_id}
          empty={{ title: "No shuls yet", description: "Shuls appear here as people sign up and add theirs." }}
          columns={[
            {
              key: "shul",
              label: "Shul",
              cell: (shul) => (
                <div className="flex min-w-0 flex-col py-2 leading-tight">
                  <Link href={`/admin/shuls/${shul.org_id}`} className="text-verdigris truncate">
                    {shul.name}
                  </Link>
                  {shul.owner_email && <span className="text-meta text-ink-soft truncate">{shul.owner_email}</span>}
                </div>
              ),
            },
            {
              key: "plan",
              label: "Plan",
              width: "w-44",
              cell: (shul) => (
                <div className="flex flex-col py-2 leading-tight">
                  <span>{planLabel(shul.plan)}</span>
                  {shul.plan === "trial" && shul.trial_ends_at && (
                    <span className="text-meta text-ink-soft">
                      {new Date(shul.trial_ends_at) < new Date() ? "Ended" : "Ends"} {shortDate(shul.trial_ends_at)}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "screens",
              label: "Screens",
              width: "w-32",
              cell: (shul) => (
                <span className="numeric">
                  {shul.screen_count}
                  {Number(shul.screen_count) > 0 && <span className="text-ink-soft">, {shul.screens_live} live</span>}
                </span>
              ),
            },
            { key: "members", label: "Members", width: "w-24", align: "right", hideBelow: "sm", cell: (shul) => <span className="numeric">{shul.member_count}</span> },
            { key: "photos", label: "Photos", width: "w-24", align: "right", hideBelow: "md", cell: (shul) => <span className="numeric">{shul.photo_count}</span> },
            { key: "storage", label: "Storage", width: "w-28", align: "right", cell: (shul) => <span className="numeric">{formatBytes(Number(shul.storage_bytes))}</span> },
            { key: "created", label: "Joined", width: "w-32", hideBelow: "md", cell: (shul) => shortDate(shul.created_at) },
          ]}
        />
      </section>
    </div>
  );
}
