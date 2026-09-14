"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { lookupShulLocation, saveShulAddress, type LocationLookupState, type SaveShulAddressState } from "../actions";

/*
 * "Where is this shul?" — type part of an address, look it up, confirm.
 *
 * TWO STEPS ON PURPOSE. The lookup fetches the full, properly formatted
 * address from whatever fragment the gabbai typed ("770 eastern" ->
 * "770 Eastern Parkway, Brooklyn, Kings County, New York, 11213, USA") and
 * shows it back with the next candle lighting there — the sanity check he can
 * actually judge, since he can't read coordinates but knows when his shul
 * lights on Friday. Only "Use this address" writes anything: it saves the
 * coordinates, ZIP and place label, and warms today's zmanim, in one step
 * (saveShulAddress, ../actions.ts).
 *
 * There is deliberately no manual coordinate entry, no separate ZIP field, and
 * no standalone "Fetch now" — the lookup formats the address, the confirm does
 * the rest.
 *
 * US ONLY, for now — the zmanim feed is a US ZIP (lib/zmanim/chabad-rss.ts).
 * The preview says so before the confirm; the save re-checks server-side.
 */
export function AddressSetup({
  locationLabel,
  postalCode,
  timezone,
  chabadEnabled,
  geocodingConfigured,
  canEdit,
}: {
  locationLabel: string | null;
  postalCode: string | null;
  /** The form's currently-selected timezone, so the previewed candle lighting
   *  is computed in the zone the gabbai is about to save. */
  timezone: string;
  chabadEnabled: boolean;
  geocodingConfigured: boolean;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<LocationLookupState>({ status: "idle" });
  const [saved, setSaved] = useState<SaveShulAddressState>({ status: "idle" });
  const [lookingUp, startLookup] = useTransition();
  const [saving, startSave] = useTransition();

  const busy = lookingUp || saving;

  const lookUp = () => {
    if (!query.trim() || busy || !canEdit) return;
    setSaved({ status: "idle" });
    startLookup(async () => setPreview(await lookupShulLocation(query, timezone)));
  };

  const use = () => {
    if (busy || !canEdit) return;
    startSave(async () => {
      const result = await saveShulAddress(query);
      setSaved(result);
      // Clear the preview only on success — a failure keeps it on screen so
      // the gabbai can see what he was confirming.
      if (result.status === "done") setPreview({ status: "idle" });
    });
  };

  const previewIsUs = preview.status === "found" && preview.countryCode === "us";

  return (
    <div className="border-rule flex flex-col gap-4 border-t pt-4">
      <div>
        <h2 className="text-heading">Where is this shul?</h2>
        <p className="text-meta text-ink-soft mt-1">
          Zmanim and candle lighting come from Chabad.org by ZIP, and the Hebrew date, parsha and daf are
          calculated from the coordinates — all worked out from the address you enter.
          {!chabadEnabled && " Chabad.org isn't turned on for this deployment yet, so zmanim aren't fetched."}
        </p>
      </div>

      {/* What the location IS right now — the thing a gabbai came to check. */}
      <div className="rounded-panel border-rule bg-paper border px-4 py-3">
        {locationLabel ? (
          <>
            <p className="text-body text-ink">{locationLabel}</p>
            {postalCode && <p className="text-meta text-ink-soft numeric mt-1">ZIP {postalCode}</p>}
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
                label="Address"
                // No `name`: this is a lookup box, not a saved field. A `name`
                // would post a stray value on the shul's Save.
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  // A new query invalidates the shown preview.
                  if (preview.status !== "idle") setPreview({ status: "idle" });
                }}
                // Enter looks up, it does not submit the shul form.
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    lookUp();
                  }
                }}
                autoComplete="off"
                disabled={!canEdit}
              />
            </div>
            <Button onClick={lookUp} disabled={busy || !canEdit || !query.trim()}>
              {lookingUp ? "Looking up" : "Look up"}
            </Button>
          </div>
          <p className="text-meta text-ink-soft">A street address, a city, or a ZIP. Only US addresses for now.</p>
        </div>
      ) : (
        <p className="text-meta text-ink-soft">
          Address lookup isn&rsquo;t set up on this deployment, so a location can&rsquo;t be set here yet.
        </p>
      )}

      {preview.status === "failed" && (
        <p role="alert" className="text-body text-ink">
          {preview.message}
        </p>
      )}

      {preview.status === "found" && (
        <div className="rounded-panel border-rule bg-paper flex flex-col gap-2 border p-4">
          {/* The full, properly formatted address — the whole point of the
              lookup step. */}
          <p className="text-body text-ink">{preview.label}</p>
          {preview.candleLighting && preview.candleLightingWhen ? (
            <p className="text-body text-ink-soft">
              Candle lighting there on {preview.candleLightingWhen}:{" "}
              {/* An actual clock time gets the sefarim face; the sentence
                  around it is prose and stays in Assistant (design.md). */}
              <span className="numeric font-sefarim text-ink">{preview.candleLighting}</span>
            </p>
          ) : (
            <p className="text-body text-ink-soft">
              No candle lighting for that place. Check the timezone above before you use it.
            </p>
          )}

          {previewIsUs ? (
            <div className="flex items-center gap-3 pt-1">
              <Button variant="primary" onClick={use} disabled={busy}>
                {saving ? "Saving" : "Use this address"}
              </Button>
              <Button variant="tertiary" onClick={() => setPreview({ status: "idle" })} disabled={busy}>
                Discard
              </Button>
            </div>
          ) : (
            <p className="text-body text-stale">
              That isn&rsquo;t a US address. The zmanim feed is US-only for now — look up a US address.
            </p>
          )}

          {/* LocationIQ's free tier permits commercial use on condition the
              application links back to it — this line is that condition, not
              decoration (lib/geocoding/locationiq.ts). */}
          <p className="text-meta text-ink-faint">
            Geocoding by{" "}
            <a href="https://locationiq.com" target="_blank" rel="noreferrer" className="text-verdigris underline">
              LocationIQ
            </a>
          </p>
        </div>
      )}

      {saved.status === "failed" && (
        <p role="alert" className="text-body text-ink">
          {saved.message}
        </p>
      )}
      {saved.status === "done" && <p className="text-body text-ink-soft">{saved.message}</p>}
    </div>
  );
}
