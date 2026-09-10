"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import { updateOrgSettings, type UpdateOrgSettingsState } from "../actions";
import { ChabadCityLookup } from "./ChabadCityLookup";
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
  zmanimLocationType,
  zmanimLocationName,
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
  zmanimLocationType: string | null;
  zmanimLocationName: string | null;
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
          Zmanim and candle lighting come from Chabad.org, looked up by the ZIP below — or, for a shul outside
          the US, by a city from Chabad.org&rsquo;s own list.
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
            THE "Chabad.org location" FIELD IS BACK, AS A SEARCH.

            It was removed as a bare text box because it was unusable three
            ways over: a gabbai had to dig an opaque numeric id out of a
            chabad.org URL, nothing said whether that id was a city or a
            ZIP, and a wrong one cached another country's times silently
            because the response carried nothing to check it against. The
            note that stood here said a field needed that gap closed too,
            not just a box.

            `Get_Locations` closes all three — id, type, and a Title the
            zmanim response's own LocationName is verified against — so
            what replaces the box is ChabadCityLookup below, inside this
            same "where is this shul?" question rather than beside it as a
            fourth competing field.
          */}
          <ChabadCityLookup
            postalCode={postalCode}
            locationId={zmanimLocationId}
            locationType={zmanimLocationType}
            locationName={zmanimLocationName}
            chabadEnabled={chabadEnabled}
          />
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
