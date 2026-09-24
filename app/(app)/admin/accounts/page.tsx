import { Table } from "@/components/Table";
import { requireUser } from "@/lib/orgs";
import { requirePlatformAdmin, shortDate } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import { AdminTabs } from "../AdminTabs";
import { AdminToggle } from "./AdminToggle";

/*
 * Every account, platform admins first, with a search. Making someone a
 * platform admin lives here: it's about the person, not any one shul.
 */

export const dynamic = "force-dynamic";

export default async function AdminAccountsPage({ searchParams }: PageProps<"/admin/accounts">) {
  await requirePlatformAdmin();
  const me = await requireUser();
  const { q } = await searchParams;
  const search = typeof q === "string" ? q : "";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_users", { p_search: search });
  if (error) throw new Error(`Couldn't load the accounts: ${error.message}`);
  const accounts = data ?? [];
  type Account = (typeof accounts)[number];

  return (
    <div className="max-w-6xl">
      <h1 className="text-title">Platform admin</h1>
      <AdminTabs />

      <form className="mt-4 flex flex-wrap items-end gap-2" role="search">
        <label className="flex flex-col gap-1">
          <span className="text-meta text-ink-soft">Find an account</span>
          <input
            name="q"
            defaultValue={search}
            placeholder="Name or email"
            className="rounded-control border-rule-firm bg-surface text-body h-8 w-72 max-w-full border px-2"
          />
        </label>
        <button type="submit" className="rounded-control border-rule-firm text-cell hover:bg-verdigris-wash/40 h-8 border px-3">
          Search
        </button>
      </form>

      <section className="rounded-panel border-rule bg-surface mt-4 overflow-x-auto border">
        <Table<Account>
          caption="Every account"
          rows={accounts}
          rowKey={(a) => a.user_id}
          empty={{
            title: search ? "No account matches" : "No accounts yet",
            description: search ? "Try part of the name or the email." : "Accounts appear here as people sign up.",
          }}
          columns={[
            {
              key: "who",
              label: "Account",
              cell: (a) => (
                <div className="flex max-w-[45vw] min-w-0 flex-col py-2 leading-tight sm:max-w-none">
                  <span className="truncate">{a.full_name || a.email}</span>
                  {a.full_name && <span className="text-meta text-ink-soft truncate">{a.email}</span>}
                </div>
              ),
            },
            { key: "shuls", label: "Shuls", hideBelow: "md", cell: (a) => <span className="text-ink-soft">{a.shuls ?? "None"}</span> },
            { key: "two-step", label: "Two-step", width: "w-24", hideBelow: "sm", cell: (a) => (a.two_step ? "On" : "Off") },
            { key: "joined", label: "Joined", width: "w-32", hideBelow: "md", cell: (a) => shortDate(a.created_at) },
            { key: "seen", label: "Last signed in", width: "w-36", hideBelow: "sm", cell: (a) => shortDate(a.last_sign_in_at) || "Never" },
            {
              key: "admin",
              label: "",
              width: "w-40",
              align: "right",
              cell: (a) => <AdminToggle userId={a.user_id} email={a.email ?? ""} admin={a.is_platform_admin} self={a.user_id === me.id} />,
            },
          ]}
        />
      </section>
      {accounts.length === 200 && <p className="text-meta text-ink-soft mt-2">Showing the first 200. Search to narrow it down.</p>}
    </div>
  );
}
