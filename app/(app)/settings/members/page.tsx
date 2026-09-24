import { Table } from "@/components/Table";
import { requestNow } from "@/lib/clock";
import { isEmailConfigured } from "@/lib/email/send";
import { hasRoleAtLeast, requireActiveOrg, requireUser, type OrgRole } from "@/lib/orgs";
import { requestOrigin } from "@/lib/origin";
import { INVITE_PATH_PREFIX } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { SettingsTabs } from "../SettingsTabs";
import { InviteForm } from "./InviteForm";
import { InviteActions, MemberActions, RoleField } from "./MemberControls";

/*
 * The people in the shul, and who's been asked to join. Everyone can see who
 * is in their shul; only an owner or admin sees the pending invitations (a
 * list of email addresses) and changes anything.
 */

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

export default async function MembersPage() {
  const org = await requireActiveOrg();
  const user = await requireUser();
  const supabase = await createClient();
  const isAdmin = hasRoleAtLeast(org.role, "admin");

  const { data: members, error } = await supabase.rpc("org_member_directory", { p_org: org.orgId });
  if (error) throw new Error(`Couldn't load the shul's members: ${error.message}`);

  const { data: invites } = isAdmin
    ? await supabase
        .from("org_invites")
        .select("id, email, role, token, expires_at, created_at")
        .eq("org_id", org.orgId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
    : { data: [] };
  const origin = await requestOrigin();
  const now = requestNow();
  const ownerCount = (members ?? []).filter((m) => m.role === "owner").length;

  type Member = NonNullable<typeof members>[number];
  type Invite = NonNullable<typeof invites>[number];

  return (
    <div className="max-w-4xl">
      <h1 className="text-title">Settings</h1>
      <SettingsTabs />

      {isAdmin && (
        <section className="rounded-panel border-rule bg-surface mt-6 border p-4 sm:p-6">
          <h2 className="text-heading">Invite someone</h2>
          <p className="text-body text-ink-soft mt-1">
            They&rsquo;ll get an email with a link to join {org.name}. If they don&rsquo;t have an account yet, they&rsquo;ll
            make one on the way.
          </p>
          <div className="mt-4">
            <InviteForm canInviteAdmins={isAdmin} emailConfigured={isEmailConfigured()} />
          </div>
        </section>
      )}

      <section className="rounded-panel border-rule bg-surface mt-6 overflow-x-auto border">
        <h2 className="text-heading px-5 pt-5 pb-2">People in {org.name}</h2>
        <Table<Member>
          caption={`People in ${org.name}`}
          rows={members ?? []}
          rowKey={(m) => m.user_id}
          empty={{ title: "Nobody here yet", description: "Invite the people who help run the screens." }}
          columns={[
            {
              key: "who",
              label: "Name",
              cell: (m) => (
                <div className="flex max-w-[45vw] min-w-0 flex-col py-2 leading-tight sm:max-w-none">
                  <span className="truncate">
                    {m.full_name || m.email}
                    {m.user_id === user.id && <span className="text-ink-soft"> (you)</span>}
                  </span>
                  {m.full_name && <span className="text-meta text-ink-soft truncate">{m.email}</span>}
                </div>
              ),
            },
            {
              key: "role",
              label: "Role",
              width: "w-28 sm:w-36",
              cell: (m) =>
                isAdmin && m.user_id !== user.id && (m.role !== "owner" || org.role === "owner") ? (
                  <RoleField userId={m.user_id} role={m.role} canGrantOwner={org.role === "owner"} />
                ) : (
                  ROLE_LABELS[m.role]
                ),
            },
            ...(isAdmin
              ? [{ key: "two-step", label: "Two-step", width: "w-24", hideBelow: "sm" as const, cell: (m: Member) => (m.two_step ? "On" : "Off") }]
              : []),
            { key: "joined", label: "Joined", width: "w-32", hideBelow: "sm", cell: (m) => dateLabel(m.joined_at) },
            {
              key: "actions",
              label: "",
              width: "w-28",
              align: "right",
              cell: (m) => {
                const self = m.user_id === user.id;
                const lastOwner = m.role === "owner" && ownerCount <= 1;
                if (self) return lastOwner ? null : <MemberActions userId={m.user_id} name="yourself" self />;
                if (!isAdmin || (m.role === "owner" && org.role !== "owner")) return null;
                return <MemberActions userId={m.user_id} name={m.full_name || m.email} />;
              },
            },
          ]}
        />
      </section>

      {isAdmin && (
        <section className="rounded-panel border-rule bg-surface mt-6 overflow-x-auto border">
          <h2 className="text-heading px-5 pt-5 pb-2">Waiting to join</h2>
          <Table<Invite>
            caption="Invitations waiting to be accepted"
            rows={invites ?? []}
            rowKey={(i) => i.id}
            empty={{
              title: "No invitations waiting",
              description: "When you invite someone, they're listed here until they join.",
            }}
            columns={[
              {
                key: "email",
                label: "Email",
                cell: (i) => <span className="block max-w-[45vw] truncate py-2 sm:max-w-none">{i.email}</span>,
              },
              { key: "role", label: "Role", width: "w-28", hideBelow: "sm", cell: (i) => ROLE_LABELS[i.role] },
              {
                key: "expires",
                label: "Expires",
                width: "w-32",
                cell: (i) =>
                  new Date(i.expires_at).getTime() < now ? (
                    <span className="text-stale">Expired</span>
                  ) : (
                    dateLabel(i.expires_at)
                  ),
              },
              {
                key: "actions",
                label: "",
                width: "sm:w-80",
                align: "right",
                cell: (i) => (
                  <InviteActions inviteId={i.id} email={i.email} link={`${origin}${INVITE_PATH_PREFIX}${i.token}`} />
                ),
              },
            ]}
          />
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-heading">What each role can do</h2>
        <table className="mt-2 w-full border-collapse">
          <caption className="sr-only">Roles</caption>
          <tbody className="text-cell">
            {[
              ["Owner", "Everything, including deleting the shul and deciding who else is an owner."],
              ["Admin", "Screens, boards, media, settings, and inviting or removing people."],
              ["Editor", "Boards, notices and photos."],
              ["Viewer", "Sees everything, changes nothing."],
            ].map(([role, what]) => (
              <tr key={role} className="border-rule border-b last:border-0">
                <th scope="row" className="w-28 py-2 pr-4 text-left font-semibold align-top">
                  {role}
                </th>
                <td className="text-ink-soft py-2">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
