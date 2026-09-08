"use client";

import { useActionState } from "react";
import { Button } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import { updateOrgSettings, type UpdateOrgSettingsState } from "../actions";

export function OrgSettingsForm({
  name,
  timezone,
  latitude,
  longitude,
  timezones,
  canEdit,
}: {
  name: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  timezones: string[];
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState<UpdateOrgSettingsState, FormData>(
    updateOrgSettings,
    {},
  );

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
          defaultValue={timezone}
          hint="Zmanim, candle lighting and davening times are all calculated here."
        >
          {timezones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </SelectField>

        <div className="flex gap-3">
          <Field
            id="latitude"
            name="latitude"
            label="Latitude"
            type="number"
            step="any"
            min={-90}
            max={90}
            defaultValue={latitude ?? ""}
            placeholder="40.6694"
          />
          <Field
            id="longitude"
            name="longitude"
            label="Longitude"
            type="number"
            step="any"
            min={-180}
            max={180}
            defaultValue={longitude ?? ""}
            placeholder="-73.9422"
          />
        </div>
        <p className="text-meta text-ink-soft -mt-2">
          The Hebrew date and candle lighting widgets need this to show a
          real time rather than nothing — look your shul&rsquo;s up on a map
          if you don&rsquo;t have it handy.
        </p>
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
          Only an owner or admin can change these — ask one of them if
          something here needs to be fixed.
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
