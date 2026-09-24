import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBytes, planLabel, requirePlatformAdmin, shortDate } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import { AdminTabs } from "../../AdminTabs";
import { PlanForm } from "./PlanForm";

/*
 * One shul, as the platform admin sees it: its numbers, and its plan. This is
 * a single bounded object, so its figures sit in one panel (design.md §5).
 */

export const dynamic = "force-dynamic";

export default async function AdminShulPage({ params }: PageProps<"/admin/shuls/[id]">) {
  await requirePlatformAdmin();
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_orgs");
  if (error) throw new Error(`Couldn't load the shul: ${error.message}`);
  const shul = (data ?? []).find((one) => one.org_id === id);
  if (!shul) notFound();

  const facts: [string, string][] = [
    ["Owner", shul.owner_email ?? "No owner"],
    ["Joined", shortDate(shul.created_at)],
    ["Screens", `${shul.screen_count}, ${shul.screens_live} live now`],
    ["Members", String(shul.member_count)],
    ["Boards", String(shul.board_count)],
    ["Photos", String(shul.photo_count)],
    ["Storage", `${formatBytes(Number(shul.storage_bytes))} in ${Number(shul.file_count).toLocaleString("en-US")} ${Number(shul.file_count) === 1 ? "file" : "files"}`],
  ];
  // Files Storage holds that no photo record accounts for — left behind by a
  // failed upload or a deletion. Worth a line when there's much of it.
  const leftover = Number(shul.storage_bytes) - Number(shul.recorded_bytes);

  return (
    <div className="max-w-4xl">
      <h1 className="text-title">Platform admin</h1>
      <AdminTabs />
      <p className="text-meta mt-4">
        <Link href="/admin" className="text-verdigris">
          Every shul
        </Link>
      </p>

      <section className="rounded-panel border-rule bg-surface mt-3 border p-4 sm:p-6">
        <h2 className="text-heading">{shul.name}</h2>
        <p className="text-meta text-ink-soft mt-1">
          {planLabel(shul.plan)}
          {shul.plan === "trial" && shul.trial_ends_at ? `, ends ${shortDate(shul.trial_ends_at)}` : ""}
        </p>
        <dl className="text-cell mt-4 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2" data-admin-shul-facts>
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-soft">{label}</dt>
              <dd className="numeric">{value}</dd>
            </div>
          ))}
        </dl>
        {leftover > 1_000_000 && (
          <p className="text-meta text-ink-soft mt-3 max-w-prose" data-admin-leftover>
            {formatBytes(leftover)} of that is files no photo in Media accounts for — left behind by uploads that
            didn&rsquo;t finish or photos since deleted.
          </p>
        )}
      </section>

      <section className="rounded-panel border-rule bg-surface mt-6 border p-4 sm:p-6">
        <h2 className="text-heading">Plan</h2>
        <p className="text-body text-ink-soft mt-1 max-w-prose">
          What {shul.name} is on. Changing it here is immediate; nothing is charged, and nothing on their screens
          changes yet.
        </p>
        <div className="mt-4">
          <PlanForm orgId={shul.org_id} plan={shul.plan} trialEndsAt={shul.trial_ends_at} />
        </div>
      </section>

      <section className="rounded-panel border-rule bg-surface mt-6 border p-4 sm:p-6">
        <h2 className="text-heading">Billing</h2>
        {shul.stripe_customer_id ? (
          <dl className="text-cell mt-3 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2">
            <dt className="text-ink-soft">Stripe customer</dt>
            <dd className="break-all">{shul.stripe_customer_id}</dd>
            <dt className="text-ink-soft">Subscription</dt>
            <dd className="break-all">{shul.stripe_subscription_id ?? "None"}</dd>
          </dl>
        ) : (
          <p className="text-body text-ink-soft mt-1 max-w-prose">
            Not connected to Stripe yet. When billing is set up, this shul&rsquo;s subscription shows here.
          </p>
        )}
      </section>
    </div>
  );
}
