"use client";

import { useActionState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { createOrg, type CreateOrgState } from "../../actions";
import { LocationLookup } from "../../LocationLookup";

export function NewOrgForm({
  geocodingConfigured,
}: {
  geocodingConfigured: boolean;
}) {
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


      {/* The same section, the same component, the same two field names, as
          the settings form — a new shul hits the "I don't know my
          coordinates" wall first, so this is where the lookup matters most.
          Nothing here is required: createOrg accepts a shul with no
          location and settings can fill it in later. */}
      <LocationLookup
        latitude={null}
        longitude={null}
        postalCode={null}
        locationLabel={null}
        geocodingConfigured={geocodingConfigured}
      />

      <div>
        <Button type="submit" variant="primary" busy={pending}>
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
