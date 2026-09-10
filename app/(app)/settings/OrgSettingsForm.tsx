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
  // One controlled select: the timezone, because it is what the lookup's
  // candle-lighting preview is calculated in. Every other field here stays
  // uncontrolled.
  //
  // The "Zmanim source" select that used to sit beside it is gone — see the
  // note where it stood.
  const [zone, setZone] = useState(timezone);



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

        {/*
          THERE IS NO "Zmanim source" SELECT ANY MORE, and it was removed
          rather than reduced to one option.

          Chabad.org is the only source for zmanim and candle lighting
          (lib/zmanim/provider.ts), so the control had exactly one choice
          left. A one-item dropdown is not a setting — it is a label that
          looks interactive, which is worse than a sentence.

          The stored `orgs.zmanim_provider` column is untouched by this
          form now: the DB enum still holds hebcal / chabad / myzmanim /
          manual, nothing migrates, and `effectiveZmanimProvider()` decides
          what a stored value means. An org still on the schema default of
          'hebcal' is served as Chabad rather than rendering nothing.

          What is left is the ZIP below, which is the whole configuration —
          which is why this note sits where the select did rather than in a
          commit message.
        */}
        <p className="text-meta text-ink-soft">
          Zmanim and candle lighting come from Chabad.org, looked up by the ZIP below.
          {!chabadEnabled && " Chabad.org isn't turned on for this deployment yet, so nothing is fetched."}
        </p>

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
            shul with no US ZIP. No path a gabbai can reach produces one:
            resolveChabadLocation only returns locationtype=1 for a value
            already in that column, and the lookup only ever writes a ZIP.

            The reader would now honour one — lib/zmanim/chabad-adapter.ts
            passes locationType through rather than hardcoding 2, which the
            embed did — but honouring it is not the same as being able to
            verify it: verifyLocationName can only check a ZIP against the
            returned LocationName, so a wrong city id would be cached
            silently. A field here needs that gap closed too, not just a
            box.

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

        {/* Unconditional now — Chabad.org is the only source, so there is
            no other provider for which a fetch button would be pointless.
            Still gated server-side on ZMANIM_CHABAD_ENABLED, which is what
            the button reports back when it is off. The ZIP itself lives
            with the location above, derived by the lookup, because it is
            plumbing either way. */}
        <FetchZmanimNow />
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
