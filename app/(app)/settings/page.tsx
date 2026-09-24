import { isGeocodingConfigured } from "@/lib/geocoding/locationiq";
import { hasRoleAtLeast, requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { OrgSettingsForm } from "./OrgSettingsForm";
import { SettingsTabs } from "./SettingsTabs";

/*
 * The shul's own settings — name and location (the timezone comes with it). Reachable by everyone
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
    .select("name, timezone, location_label, postal_code")
    .eq("id", org.orgId)
    .single();

  if (error || !data) {
    throw new Error(`Couldn't load the shul's settings: ${error?.message ?? "not found"}`);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-title">Settings</h1>
      <SettingsTabs />
      <p className="text-body text-ink-soft mt-4">
        Every time-based widget on every board is calculated from these.
      </p>

      <div className="rounded-panel border-rule bg-surface mt-6 border p-6">
        <OrgSettingsForm
          name={data.name}
          timezone={data.timezone}
          locationLabel={data.location_label}
          postalCode={data.postal_code}
          // Off by default (docs/environment.md). It gates whether "Use this
          // address" actually fetches zmanim; the address is still saved
          // either way, and AddressSetup says so when it is off.
          chabadEnabled={process.env.ZMANIM_CHABAD_ENABLED === "true"}
          // Whether GEOCODING_API_KEY is set (docs/environment.md). Without
          // it AddressSetup says a location can't be set here, rather than
          // offering a lookup that can only fail.
          geocodingConfigured={isGeocodingConfigured()}
          canEdit={hasRoleAtLeast(org.role, "admin")}
        />
      </div>
    </div>
  );
}
