"use client";

import { useActionState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { updateOrgSettings, type UpdateOrgSettingsState } from "../actions";
import { AddressSetup } from "./AddressSetup";

/*
 * The shul's settings: its name (saved by the form's own Save), and the
 * location (set by AddressSetup, which geocodes, saves and warms in one step
 * from a single address field). The timezone is not asked for: it comes with
 * the address (lib/geocoding/timezone.ts), and AddressSetup shows it back.
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
  canEdit,
}: {
  name: string;
  timezone: string;
  locationLabel: string | null;
  postalCode: string | null;
  chabadEnabled: boolean;
  geocodingConfigured: boolean;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState<UpdateOrgSettingsState, FormData>(updateOrgSettings, {});

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

        </fieldset>

        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" busy={pending}>
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
        timezone={timezone}
        chabadEnabled={chabadEnabled}
        geocodingConfigured={geocodingConfigured}
        canEdit={canEdit}
      />
    </div>
  );
}
