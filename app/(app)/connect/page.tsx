import Link from "next/link";
import { buttonClassName } from "@/components/Button";
import { hasRoleAtLeast, requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { ConnectForm } from "./ConnectForm";

/*
 * Where the QR code on a TV's /pair page leads: this page on a phone, with the
 * code already filled in. Choose which screen the TV is, and it's connected.
 * Signed in like the rest of the dashboard (the proxy sends a signed-out phone
 * through sign-in and back here, code and all).
 */

export const dynamic = "force-dynamic";

export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const { code } = await searchParams;
  const org = await requireActiveOrg();
  const initialCode = typeof code === "string" ? code.replace(/\D/g, "").slice(0, 6) : "";

  if (!hasRoleAtLeast(org.role, "admin")) {
    return (
      <div className="max-w-xl">
        <h1 className="text-title">Connect a TV</h1>
        <p className="text-body text-ink-soft mt-2">
          Only an owner or admin of {org.name} can connect a TV. Ask one of them to scan the code.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: screens, error } = await supabase
    .from("screens")
    .select("id, name, location_note, device_paired_at")
    .eq("org_id", org.orgId)
    .order("name");
  if (error) throw new Error(`Couldn't load the screens: ${error.message}`);
  const open = (screens ?? []).filter((screen) => !screen.device_paired_at);

  return (
    <div className="max-w-xl">
      <h1 className="text-title">Connect a TV</h1>
      <p className="text-body text-ink-soft mt-1">Choose which of {org.name}&rsquo;s screens this TV is.</p>

      <div className="rounded-panel border-rule bg-surface mt-6 border p-4 sm:p-6">
        {open.length === 0 ? (
          <>
            <h2 className="text-heading">Every screen already has a TV</h2>
            <p className="text-body text-ink-soft mt-1">
              Add a screen for this TV, or disconnect the TV of the screen it&rsquo;s replacing.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/screens/new" className={buttonClassName("primary")}>
                Add screen
              </Link>
              <Link href="/screens" className={buttonClassName("secondary")}>
                See screens
              </Link>
            </div>
          </>
        ) : (
          <ConnectForm
            screens={open.map((screen) => ({ id: screen.id, name: screen.name, note: screen.location_note }))}
            initialCode={initialCode}
          />
        )}
      </div>
    </div>
  );
}
