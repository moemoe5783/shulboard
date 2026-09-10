"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import { updateOrgSettings, type UpdateOrgSettingsState } from "../actions";
import { FetchZmanimNow } from "./FetchZmanimNow";
import { LocationLookup } from "../LocationLookup";

export function OrgSettingsForm({
  name,
  timezone,
  latitude,
  longitude,
  locationLabel,
  zmanimProvider,
  postalCode,
  zmanimLocationId,
  chabadEnabled,
  geocodingConfigured,
  timezones,
  canEdit,
}: {
  name: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  locationLabel: string | null;
  zmanimProvider: string;
  postalCode: string | null;
  zmanimLocationId: string | null;
  chabadEnabled: boolean;
  geocodingConfigured: boolean;
  timezones: string[];
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState<UpdateOrgSettingsState, FormData>(
    updateOrgSettings,
    {},
  );
  // Two controlled selects, for two reasons that both need the live value
  // rather than the saved one: the provider decides whether the Chabad
  // fields show, and the timezone is what the lookup's candle-lighting
  // preview is calculated in. Every other field here stays uncontrolled.
  const [provider, setProvider] = useState(zmanimProvider);
  const [zone, setZone] = useState(timezone);

  const isChabad = provider === "chabad";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset disabled={!canEdit || pending} className="flex flex-col gap-4">
        <Field
          id="name"
          name="name"
          label="Shul name"
          required
          maxLength={120}
          defaultValue={name}
          autoComplete="organization"
        />

        <SelectField
          id="timezone"
          name="timezone"
          label="Timezone"
          required
          value={zone}
          onChange={(event) => setZone(event.target.value)}
          hint="Every time on every board is shown in this zone."
        >
          {timezones.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectField>

        {/* Above the location section on purpose: it decides which location
            fields that section needs. */}
        <SelectField
          id="zmanimProvider"
          name="zmanimProvider"
          label="Zmanim source"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          hint="What candle lighting and other zmanim widgets calculate from, unless a widget picks its own."
        >
          <option value="hebcal">Hebcal</option>
          {chabadEnabled && <option value="chabad">Chabad.org</option>}
          <option value="manual">Manual</option>
        </SelectField>

        <LocationLookup
          latitude={latitude}
          longitude={longitude}
          postalCode={postalCode}
          locationLabel={locationLabel}
          timezone={zone}
          geocodingConfigured={geocodingConfigured}
        >
          {/*
            THERE IS NO "Chabad.org location" FIELD, and that is deliberate.

            It wrote orgs.zmanim_location_id, and its purpose was Chabad's
            locationtype=1 — their own opaque internal city numbering, for a
            shul with no US ZIP. Nothing can use it: lib/zmanim/chabad-embed
            .ts hardcodes locationtype=2, and every path a gabbai can reach
            resolves to a ZIP anyway.

            THE COLUMN STAYS (supabase/migrations/20260909090000_orgs_zmanim
            _location_id.sql) and is still read by resolveChabadLocation, the
            bundle builder and the warming cron. Non-US shuls are where it
            comes back: that is the case a ZIP cannot express, and it needs a
            locationtype selector beside it to be usable at all rather than
            one more numeric box. Any stored value is preserved here rather
            than dropped by this field's removal.
          */}
          <input type="hidden" name="zmanimLocationId" value={zmanimLocationId ?? ""} />
        </LocationLookup>

        {/* Chabad.org is the only source that reads the ZIP, so this is the
            only source that gets a button to fetch from. The field itself
            lives with the location above, derived by the lookup, because it
            is plumbing either way. */}
        {isChabad && <FetchZmanimNow />}
      </fieldset>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving" : "Save"}
          </Button>
          {state.saved && !state.warning && <span className="text-body text-ink-soft">Saved</span>}
        </div>
      ) : (
        <p className="text-meta text-ink-soft">
          Only an owner or admin can change these — ask one of them if
          something here needs to be fixed.
        </p>
      )}

      {/* Saved, but something is worth looking at — a ZIP and a set of
          coordinates in different states. Not an error: the row is written.
          --stale is the dashboard's own "needs attention, nothing is
          broken" color (design.md §3), and status colors are only ever
          used for status. */}
      {state.warning && (
        <p role="alert" className="text-body text-stale">
          {state.warning}
        </p>
      )}

      {state.error && (
        <p role="alert" className="text-body text-ink">
          {state.error}
        </p>
      )}
    </form>
  );
}
