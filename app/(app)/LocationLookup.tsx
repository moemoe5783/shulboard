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
 * WHAT THE SUMMARY CAN AND CANNOT SAY. A place name exists only for the
 * page session in which the lookup ran: there is no column storing it, and
 * reverse-geocoding on every settings view to recover a label would be a
 * network call to render a caption. So an org configured before this — or
 * revisited after a reload — shows its actual stored coordinates as text
 * instead. That is less pretty and completely truthful, which is the trade
 * this section exists to make.
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
  timezone,
  geocodingConfigured,
  children,
}: {
  latitude: number | null;
  longitude: number | null;
  /** The form's own currently-selected timezone, so the previewed candle
   *  lighting is checked against the zone the gabbai is about to save
   *  rather than the one on file. */
  timezone: string;
  geocodingConfigured: boolean;
  /** Provider-specific location inputs — the settings form's ZIP and
   *  Chabad.org location id. Rendered inside this section because they
   *  answer the same question; the new-shul form passes none. */
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

  // Which place the coordinates were filled from, cleared the moment they
  // are edited by hand — a label claiming a place the numbers no longer
  // match would be the same lie the old coordinate placeholders told.
  // Null on every fresh page load, by design: see the header comment on
  // what the summary can and cannot say.
  const [filledFrom, setFilledFrom] = useState<string | null>(null);

  const hasCoordinates = latitudeValue.trim() !== "" && longitudeValue.trim() !== "";

  const runLookup = () => {
    if (!query.trim() || pending) return;
    startTransition(async () => {
      setResult(await lookupShulLocation(query, timezone));
    });
  };

  const confirm = (place: { label: string; latitude: number; longitude: number }) => {
    setLatitudeValue(String(place.latitude));
    setLongitudeValue(String(place.longitude));
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
          <p className="text-body text-ink">{filledFrom}</p>
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
        </div>
      </details>

      {children}
    </div>
  );
}
