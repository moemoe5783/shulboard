"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import { updateOrgSettings, type UpdateOrgSettingsState } from "../actions";
import { LocationLookup } from "../LocationLookup";

export function OrgSettingsForm({
  name,
  timezone,
  latitude,
  longitude,
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
          timezone={zone}
          geocodingConfigured={geocodingConfigured}
        >
          {isChabad ? (
            <>
              <Field
                id="postalCode"
                name="postalCode"
                label="ZIP code"
                defaultValue={postalCode ?? ""}
                hint="US only. Chabad.org has no way to accept coordinates, so it resolves its times from the center of this ZIP rather than from the latitude and longitude above — expect its times to differ from Hebcal's by a minute or so."
              />
              <Field
                id="zmanimLocationId"
                name="zmanimLocationId"
                label="Chabad.org location"
                defaultValue={zmanimLocationId ?? ""}
                hint="Only needed without a US ZIP above. Copy the number out of your own chabad.org candle-lighting page URL (…/locationId/<this>/locationType/…)."
              />
            </>
          ) : (
            /* Hebcal and Manual don't read either of these, so neither field
               is shown — but the form is what the save reads, so without
               these the stored values would be wiped the first time a gabbai
               saved on Hebcal, and switching back to Chabad.org would find
               them gone. */
            <>
              <input type="hidden" name="postalCode" value={postalCode ?? ""} />
              <input type="hidden" name="zmanimLocationId" value={zmanimLocationId ?? ""} />
            </>
          )}
        </LocationLookup>
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
