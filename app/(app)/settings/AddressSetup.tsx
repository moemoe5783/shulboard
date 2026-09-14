"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { saveShulAddress, type SaveShulAddressState } from "../actions";

/*
 * "Where is this shul?" — one field, and pressing the button does everything.
 *
 * THIS REPLACED THREE CONTROLS: the address-lookup-then-confirm flow, the
 * manual latitude/longitude disclosure, and the standalone "Fetch now" button.
 * A gabbai has no reason to read two decimal numbers or a ZIP, so none of them
 * is a field here. He types where the shul is; "Use this address" geocodes it,
 * saves the coordinates, ZIP and place name to the backend, and warms today's
 * zmanim — all in `saveShulAddress` (../actions.ts).
 *
 * US ONLY, for now — the zmanim feed is a US ZIP (lib/zmanim/chabad-rss.ts),
 * so the action refuses a non-US result rather than saving a location no
 * zmanim can be fetched for.
 *
 * The confirmation the gabbai actually judges is the candle-lighting time the
 * result reports back: he can't check coordinates, but he knows when his shul
 * lights on Friday, so a wrong place shows a visibly wrong time.
 */
export function AddressSetup({
  locationLabel,
  postalCode,
  chabadEnabled,
  geocodingConfigured,
  canEdit,
}: {
  locationLabel: string | null;
  postalCode: string | null;
  chabadEnabled: boolean;
  geocodingConfigured: boolean;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SaveShulAddressState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const run = () => {
    if (!query.trim() || pending || !canEdit) return;
    startTransition(async () => {
      setResult(await saveShulAddress(query));
    });
  };

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
                // No `name`: this triggers its own action, it is not a saved
                // form field. A `name` would post a stray value on the shul's
                // Save.
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                // Enter here should use the address, not submit the shul form.
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    run();
                  }
                }}
                autoComplete="off"
                disabled={!canEdit}
              />
            </div>
            <Button variant="primary" onClick={run} disabled={pending || !canEdit || !query.trim()}>
              {pending ? "Saving" : "Use this address"}
            </Button>
          </div>
          <p className="text-meta text-ink-soft">A US street address, city, or ZIP. Only US addresses for now.</p>
        </div>
      ) : (
        <p className="text-meta text-ink-soft">
          Address lookup isn&rsquo;t set up on this deployment, so a location can&rsquo;t be set here yet.
        </p>
      )}

      {result.status === "failed" && (
        <p role="alert" className="text-body text-ink">
          {result.message}
        </p>
      )}

      {result.status === "done" && (
        <div className="rounded-panel border-rule bg-paper flex flex-col gap-1 border p-4">
          <p className="text-body text-ink">{result.message}</p>
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
    </div>
  );
}
