"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import { updateOrgSettings, type UpdateOrgSettingsState } from "../actions";
import { AddressSetup } from "./AddressSetup";

/*
 * The shul's settings: name and timezone (saved by the form's own Save), and
 * the location (set by AddressSetup, which geocodes, saves and warms in one
 * step from a single address field).
 *
 * LOCATION IS NO LONGER PART OF THIS FORM'S SAVE. It used to carry a
 * coordinate disclosure, a ZIP field, a Chabad city search and a "Fetch now"
 * button; all of that is now one address field in AddressSetup below. Keeping
 * location out of `updateOrgSettings` is also what stops a plain rename from
 * blanking the shul's coordinates.
 */
export function OrgSettingsForm({
  name,
  timezone,
  locationLabel,
  postalCode,
  chabadEnabled,
  geocodingConfigured,
  timezones,
  canEdit,
}: {
  name: string;
  timezone: string;
  locationLabel: string | null;
  postalCode: string | null;
  chabadEnabled: boolean;
  geocodingConfigured: boolean;
  timezones: string[];
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState<UpdateOrgSettingsState, FormData>(updateOrgSettings, {});
  const [zone, setZone] = useState(timezone);

  return (
    <div className="flex flex-col gap-4">
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
            hint="Every time on every board is shown in this zone. Set it before adding an address so zmanim are fetched in the right zone."
          >
            {timezones.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
        </fieldset>

        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving" : "Save"}
            </Button>
            {state.saved && <span className="text-body text-ink-soft">Saved</span>}
          </div>
        ) : (
          <p className="text-meta text-ink-soft">
            Only an owner or admin can change these — ask one of them if something here needs to be fixed.
          </p>
        )}

        {state.error && (
          <p role="alert" className="text-body text-ink">
            {state.error}
          </p>
        )}
      </form>

      <AddressSetup
        locationLabel={locationLabel}
        postalCode={postalCode}
        timezone={zone}
        chabadEnabled={chabadEnabled}
        geocodingConfigured={geocodingConfigured}
        canEdit={canEdit}
      />
    </div>
  );
}
