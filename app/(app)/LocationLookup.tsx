"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { lookupShulLocation, type LocationLookupState } from "./actions";

/*
 * "Where is this shul?" — the one question, with every input that answers
 * it underneath.
 *
 * THE ORDER MATTERS. Look up an address, read back the resolved place and
 * the candle lighting there, and only then does confirming fill the
 * coordinates — nothing is written until the form is saved. A gabbai
 * cannot check 40.669, but he knows when his shul lights on Friday, so the
 * previewed time is the actual sanity check and the reason the confirm step
 * exists rather than the lookup filling the fields silently.
 *
 * THE COORDINATES ARE NOT A FIELD BY DEFAULT. They are internal detail —
 * a gabbai has no reason to read two decimal numbers, and offering them as
 * inputs invites hand-editing that quietly desyncs them from the ZIP
 * Chabad.org resolves from. So what shows is what the location IS, as
 * text, and the inputs live behind a disclosure.
 *
 * WHAT THE SUMMARY SAYS. The resolved place name is persisted
 * (`orgs.location_label`) and read back on every visit, so returning to
 * this page shows where the shul is rather than two decimal numbers. That
 * label is a cached string and nothing computes from it — latitude and
 * longitude remain the only inputs to any zmanim calculation.
 *
 * It can still legitimately be absent: coordinates typed by hand have no
 * label, and neither do orgs saved before the column existed. The summary
 * falls back to the coordinates as text there rather than inventing
 * something, and editing the coordinates by hand clears the label rather
 * than leaving one that names the wrong place. Nothing reverse-geocodes on
 * load to fill the gap — that would be a network call and a quota unit
 * spent rendering a caption.
 *
 * THE LOOKUP IS NEVER A GATE. Manual latitude and longitude are always
 * reachable, and are shown open rather than collapsed when there is no
 * geocoding key at all, because then they are the only way in. A shul must
 * be able to finish this form with the service down.
 *
 * Shared by the settings form and the new-shul form. Both post the same two
 * `latitude`/`longitude` field names their server actions already read, so
 * neither save path changed to accommodate any of this.
 */

export function LocationLookup({
  latitude,
  longitude,
  postalCode,
  locationLabel,
  timezone,
  geocodingConfigured,
  children,
}: {
  latitude: number | null;
  longitude: number | null;
  /** The org's stored `postal_code`. Derived from the lookup in the normal
   *  path and hand-editable under the same disclosure as the coordinates —
   *  it is plumbing, not a question a gabbai should be asked. */
  postalCode: string | null;
  /** The stored place name the coordinates came from — `orgs.location_label`.
   *  A cached label, never a source of truth: null for coordinates typed by
   *  hand or saved before the column existed, and the summary falls back to
   *  the coordinates themselves there rather than pretending. */
  locationLabel: string | null;
  /** The form's own currently-selected timezone, so the previewed candle
   *  lighting is checked against the zone the gabbai is about to save
   *  rather than the one on file. */
  timezone: string;
  geocodingConfigured: boolean;
  /** Anything else that belongs to this question — the settings form
   *  passes its Chabad.org city search (ChabadCityLookup), which is the
   *  other way to answer "where is this shul?" for a shul with no US ZIP.
   *  Inside this component rather than beside it so the two are one
   *  question with two answers, not two competing location fields. The
   *  new-shul form passes none: its actions are admin-of-an-existing-org
   *  gated, and a non-US shul sets the city in settings straight after
   *  creating the org. */
  children?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LocationLookupState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  // Controlled, so confirming a lookup can fill them. Strings rather than
  // numbers: an empty input is "", and a half-typed "-" or "40." has to
  // survive being typed.
  const [latitudeValue, setLatitudeValue] = useState(latitude === null ? "" : String(latitude));
  const [longitudeValue, setLongitudeValue] = useState(longitude === null ? "" : String(longitude));
  const [postalCodeValue, setPostalCodeValue] = useState(postalCode ?? "");

  // The place name shown in the summary and posted back on save. Seeded
  // from the stored label, replaced when a lookup is confirmed, and cleared
  // the moment the coordinates are edited by hand — a label naming a place
  // the numbers no longer match would be the same lie the old coordinate
  // placeholders told.
  const [filledFrom, setFilledFrom] = useState<string | null>(locationLabel);

  const hasCoordinates = latitudeValue.trim() !== "" && longitudeValue.trim() !== "";

  const runLookup = () => {
    if (!query.trim() || pending) return;
    startTransition(async () => {
      setResult(await lookupShulLocation(query, timezone));
    });
  };

  const confirm = (place: {
    label: string;
    latitude: number;
    longitude: number;
    postcode: string | null;
  }) => {
    setLatitudeValue(String(place.latitude));
    setLongitudeValue(String(place.longitude));
    // Only when the result actually carried one. A lookup that resolved a
    // place with no postcode — a country that doesn't use them, or a city
    // centroid — must not wipe a ZIP a gabbai already has on file, since
    // that is the one field Chabad.org resolves its times from.
    if (place.postcode) setPostalCodeValue(place.postcode);
    setFilledFrom(place.label);
    setResult({ status: "idle" });
  };

  return (
    <div className="border-rule flex flex-col gap-4 border-t pt-4">
      <div>
        <h2 className="text-heading">Where is this shul?</h2>
        <p className="text-meta text-ink-soft mt-1">
          Candle lighting, the Hebrew date, parsha and daf yomi are all
          calculated from this. Without it those widgets show nothing.
        </p>
      </div>

      {/* What the location IS right now — the thing a gabbai came here to
          check. Read from the pending values, not the saved props, so
          confirming a lookup or editing by hand is reflected immediately. */}
      <div className="rounded-panel border-rule bg-paper border px-4 py-3">
        {filledFrom ? (
          <>
            <p className="text-body text-ink">{filledFrom}</p>
            {/* The numbers stay visible, quietly. They are what every zmanim
                calculation actually reads, so a gabbai checking the place
                name shouldn't have to open the disclosure to see them. */}
            <p className="text-meta text-ink-soft numeric mt-1">
              {latitudeValue}, {longitudeValue}
            </p>
          </>
        ) : hasCoordinates ? (
          <>
            <p className="text-body text-ink numeric">
              {latitudeValue}, {longitudeValue}
            </p>
            {/* The advice has to match what's actually available: with no
                geocoding key there is no lookup to point at. */}
            <p className="text-meta text-ink-soft mt-1">
              {geocodingConfigured
                ? "No place name stored for these. Look up an address to check they're right."
                : "No place name stored for these — only the coordinates themselves."}
            </p>
          </>
        ) : (
          <p className="text-body text-ink-soft">No location set yet.</p>
        )}
      </div>

      {geocodingConfigured ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field
                id="addressQuery"
                label="Address or city"
                // No `name`: this is a lookup box, not a saved field. Giving
                // it one would post a stray value to an action that has no
                // column for it.
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                // Enter inside a form submits the form. Here that would save
                // the shul instead of looking up an address, which is the
                // opposite of "nothing is written until you confirm".
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runLookup();
                  }
                }}
                autoComplete="off"
              />
            </div>
            <Button onClick={runLookup} disabled={pending || !query.trim()}>
              {pending ? "Looking up" : "Look up"}
            </Button>
          </div>
          <p className="text-meta text-ink-soft">
            A street address, a city, or a ZIP. Check the result before you use it.
          </p>
        </div>
      ) : (
        <p className="text-meta text-ink-soft">
          Address lookup isn&rsquo;t set up on this deployment, so enter the
          coordinates by hand below.
        </p>
      )}

      {result.status === "failed" && (
        <p role="alert" className="text-body text-ink">
          {result.message}
        </p>
      )}

      {result.status === "found" && (
        <div className="rounded-panel border-rule bg-paper flex flex-col gap-2 border p-4">
          <p className="text-body text-ink">{result.label}</p>
          {result.candleLighting && result.candleLightingWhen ? (
            <p className="text-body text-ink-soft">
              Candle lighting there on {result.candleLightingWhen}:{" "}
              {/* An actual clock time, so it gets the sefarim face
                  (design.md: "only actual clock times"). The surrounding
                  sentence is prose and stays in Assistant. */}
              <span className="numeric font-sefarim text-ink">{result.candleLighting}</span>
            </p>
          ) : (
            <p className="text-body text-ink-soft">
              No candle lighting for those coordinates. Check the timezone
              above before you use them.
            </p>
          )}
          <p className="text-meta text-ink-soft numeric">
            {result.latitude}, {result.longitude}
          </p>
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={() => confirm(result)}>Use this location</Button>
            <Button variant="tertiary" onClick={() => setResult({ status: "idle" })}>
              Discard
            </Button>
          </div>
          {/* LocationIQ's free tier permits commercial use on condition the
              application links back to it. This line is that condition, not
              decoration — see lib/geocoding/locationiq.ts. */}
          <p className="text-meta text-ink-faint">
            Geocoding by{" "}
            <a href="https://locationiq.com" target="_blank" rel="noreferrer" className="text-verdigris underline">
              LocationIQ
            </a>
          </p>
        </div>
      )}

      {/*
        A native <details>, not conditional rendering. Its children stay in
        the DOM when it is closed — `display: none` inputs are still
        submitted, only `disabled` ones are dropped — so the coordinates
        post whether the gabbai ever opens this or not. Rendering them
        conditionally would silently clear the org's location on any save
        made with the disclosure shut.

        Open by default when there is no geocoding key, because then these
        two fields are the only way to set a location at all.
      */}
      <details open={!geocodingConfigured}>
        <summary className="text-meta text-verdigris w-fit cursor-pointer">
          Enter coordinates manually
        </summary>
        <div className="mt-2 flex flex-col gap-1">
          <div className="flex gap-3">
            <Field
              id="latitude"
              name="latitude"
              label="Latitude"
              type="number"
              step="any"
              min={-90}
              max={90}
              value={latitudeValue}
              onChange={(event) => {
                setLatitudeValue(event.target.value);
                setFilledFrom(null);
              }}
            />
            <Field
              id="longitude"
              name="longitude"
              label="Longitude"
              type="number"
              step="any"
              min={-180}
              max={180}
              value={longitudeValue}
              onChange={(event) => {
                setLongitudeValue(event.target.value);
                setFilledFrom(null);
              }}
            />
          </div>
          <p className="text-meta text-ink-soft">
            For a shul the lookup can&rsquo;t find. Fill in both, or leave
            both blank.
          </p>

          <Field
            id="postalCode"
            name="postalCode"
            label="ZIP code"
            className="mt-2"
            value={postalCodeValue}
            onChange={(event) => setPostalCodeValue(event.target.value)}
            hint="US only, and the lookup fills it in. Chabad.org can't take coordinates, so it resolves its times from this ZIP's center rather than from the coordinates above — expect a minute's difference from Hebcal. A lookup outside the US leaves this alone instead of clearing it, so check it by hand there."
          />
        </div>
      </details>

      {/* Posted so the place name survives the page. Hidden rather than a
          field: it is not something a gabbai should type or correct, it is
          a record of what the lookup resolved, and it is cleared above the
          moment the coordinates stop matching it. */}
      <input type="hidden" name="locationLabel" value={filledFrom ?? ""} />

      {children}
    </div>
  );
}
