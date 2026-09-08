"use client";

import { useActionState } from "react";
import { Button } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import { createOrg, type CreateOrgState } from "../../actions";

export function NewOrgForm({ timezones }: { timezones: string[] }) {
  const [state, formAction, pending] = useActionState<CreateOrgState, FormData>(
    createOrg,
    {},
  );

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
        defaultValue="America/New_York"
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
          placeholder="-73.9422"
        />
      </div>
      <p className="text-meta text-ink-soft -mt-2">
        Optional for now, but the Hebrew date, candle lighting and Havdalah widgets
        need it to show a real time rather than nothing — look your shul&rsquo;s up
        on a map if you don&rsquo;t have it handy.
      </p>

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
