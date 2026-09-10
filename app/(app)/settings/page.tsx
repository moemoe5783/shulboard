import { isGeocodingConfigured } from "@/lib/geocoding/locationiq";
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
    .select("name, timezone, latitude, longitude, location_label, postal_code, zmanim_location_id, zmanim_location_type, zmanim_location_name")
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
        Every time-based widget on every board is calculated from these.
      </p>

      <div className="rounded-panel border-rule bg-surface mt-6 border p-6">
        <OrgSettingsForm
          name={data.name}
          timezone={data.timezone}
          latitude={data.latitude}
          longitude={data.longitude}
          locationLabel={data.location_label}
          postalCode={data.postal_code}
          zmanimLocationId={data.zmanim_location_id}
          zmanimLocationType={data.zmanim_location_type}
          zmanimLocationName={data.zmanim_location_name}
          // Off by default (docs/environment.md). There is no longer a
          // provider option for this to hide — Chabad.org is the only
          // source — so what it controls now is whether the city search
          // reaches chabad.org at all, and the form says so when it is
          // off. Both server actions behind that search re-check the same
          // flag; this only controls what the form offers.
          chabadEnabled={process.env.ZMANIM_CHABAD_ENABLED === "true"}
          // Whether GEOCODING_API_KEY is set (docs/environment.md). Without
          // it the form says so and points at the coordinate fields, rather
          // than offering a Look up button that can only fail.
          geocodingConfigured={isGeocodingConfigured()}
          timezones={timezones}
          canEdit={hasRoleAtLeast(org.role, "admin")}
        />
      </div>
    </div>
  );
}
