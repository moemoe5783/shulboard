import { hasRoleAtLeast, requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { OrgSettingsForm } from "./OrgSettingsForm";

/*
 * The shul's own settings — name, timezone, location. Reachable by everyone
 * in the org (design.md's rail is the map of the product; a viewer should
 * still be able to see what a screen's candle lighting is computed against),
 * editable only by an admin or owner — OrgSettingsForm shows why when it
 * isn't.
 */

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const org = await requireActiveOrg();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("orgs")
    .select("name, timezone, latitude, longitude")
    .eq("id", org.orgId)
    .single();

  if (error || !data) {
    throw new Error(`Couldn't load the shul's settings: ${error?.message ?? "not found"}`);
  }

  // Intl.supportedValuesOf is the whole IANA list — same source orgs/new/
  // page.tsx uses, so the two forms never disagree about what's offered.
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    <div className="max-w-3xl">
      <h1 className="text-title">Settings</h1>
      <p className="text-body text-ink-soft mt-1">
        Zmanim, candle lighting, the Hebrew date and every other time-based
        element are calculated from here.
      </p>

      <div className="rounded-panel border-rule bg-surface mt-6 border p-6">
        <OrgSettingsForm
          name={data.name}
          timezone={data.timezone}
          latitude={data.latitude}
          longitude={data.longitude}
          timezones={timezones}
          canEdit={hasRoleAtLeast(org.role, "admin")}
        />
      </div>
    </div>
  );
}
