"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import { createOrg, type CreateOrgState } from "../../actions";
import { LocationLookup } from "../../LocationLookup";

export function NewOrgForm({
  timezones,
  geocodingConfigured,
}: {
  timezones: string[];
  geocodingConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState<CreateOrgState, FormData>(
    createOrg,
    {},
  );
  // Controlled only so the location lookup can calculate its candle-lighting
  // preview in the zone about to be saved.
  const [zone, setZone] = useState("America/New_York");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field
        id="name"
        name="name"
        label="Shul name"
        required
        maxLength={120}
        placeholder="Beis Menachem"
        autoComplete="organization"
      />

      <SelectField
        id="timezone"
        name="timezone"
        label="Timezone"
        required
        // The schema's own default. Zmanim are calculated against this, so it is
        // set deliberately rather than guessed from a browser that might be
        // travelling.
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

      {/* The same section, the same component, the same two field names, as
          the settings form — a new shul hits the "I don't know my
          coordinates" wall first, so this is where the lookup matters most.
          Nothing here is required: createOrg accepts a shul with no
          location and settings can fill it in later. */}
      <LocationLookup latitude={null} longitude={null} timezone={zone} geocodingConfigured={geocodingConfigured} />

      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Adding" : "Add shul"}
        </Button>
      </div>

      {state.error && (
        <p role="alert" className="text-body text-ink">
          {state.error}
        </p>
      )}
    </form>
  );
}
