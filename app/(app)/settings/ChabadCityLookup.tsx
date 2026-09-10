"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import {
  checkChabadCity,
  searchChabadCity,
  type ChabadCityCheckState,
  type ChabadCitySearchState,
} from "../actions";

/*
 * "This shul has no US ZIP" — the one case a ZIP cannot answer, and the
 * reason non-US shuls could not use this product's zmanim at all.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT WENT. A bare "Chabad.org location" text
 * box wrote `orgs.zmanim_location_id` and was removed as unusable: a
 * gabbai had to dig an opaque numeric id out of a chabad.org URL by hand,
 * there was no way to say whether it was a city id or a ZIP, and a wrong
 * one cached another country's times silently because the response carried
 * nothing to check it against. Three problems, and a text box solved none
 * of them.
 *
 * `Get_Locations` solves all three at once: it takes a city name, returns
 * the id AND its type, AND the Title that the zmanim response's own
 * `LocationName` can then be verified against
 * (lib/zmanim/chabad-adapter.ts). So this is a search, not a field.
 *
 * THE ORDER MATTERS, same as the address lookup's. Search, pick from what
 * chabad.org offers, then CONFIRM — and the confirm actually fetches zmanim
 * for that id and shows back what chabad.org calls the place and when it
 * lights this Friday. Nothing is written until the form is saved. A gabbai
 * cannot judge "872", but he knows the name of his city and roughly when
 * his shul lights, so the confirmation is the real check and the reason it
 * exists rather than the pick filling a hidden field silently.
 *
 * A ZIP WINS, AND THIS SAYS SO RATHER THAN COMPETING WITH IT.
 * `resolveChabadLocation` is ZIP-first, so a shul with a US ZIP on file
 * gets that ZIP whatever is stored here. Presenting two location fields as
 * equals is exactly the mistake the old third field made, so this one
 * announces the precedence and stays shut when it does not apply.
 */

export function ChabadCityLookup({
  postalCode,
  locationId,
  locationType,
  locationName,
  chabadEnabled,
}: {
  /** The SAVED ZIP, deliberately, not the form's live value. It is what the
   *  board is actually resolving from right now, which is what the
   *  precedence note has to be true about. */
  postalCode: string | null;
  locationId: string | null;
  locationType: string | null;
  locationName: string | null;
  chabadEnabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<ChabadCitySearchState>({ status: "idle" });
  const [searching, startSearch] = useTransition();
  const [check, setCheck] = useState<ChabadCityCheckState>({ status: "idle" });
  const [checking, startCheck] = useTransition();

  /*
   * The three values posted on save, and they move together — an id
   * without its type has no meaning and an id without its name cannot be
   * verified, so the server clears all three if any is missing
   * (parseZmanimFields). Seeded from what is stored, replaced only when a
   * confirmation succeeds.
   */
  const [chosen, setChosen] = useState(
    locationId && locationType && locationName
      ? { value: locationId, type: locationType, title: locationName }
      : null,
  );

  const hasZip = Boolean(postalCode?.trim());
  // Open when this is the case that needs answering: no ZIP and nothing
  // picked yet. A shul that has already answered, or that has a ZIP, gets
  // it shut.
  const open = !hasZip && !chosen;

  return (
    <details open={open}>
      <summary className="text-meta text-verdigris w-fit cursor-pointer">
        {chosen ? `Chabad.org city: ${chosen.title}` : "No US ZIP? Find this shul's city on Chabad.org"}
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        {/*
          The precedence, said plainly and first. A gabbai who has a ZIP and
          searches anyway would otherwise store a city id that nothing ever
          reads and have no way to know.
        */}
        {hasZip && (
          <p className="text-meta text-ink-soft">
            This shul has a US ZIP on file ({postalCode?.trim()}), and Chabad.org looks zmanim up by that. A city
            picked here would be stored and never used. Clear the ZIP first if this shul isn&rsquo;t in the US.
          </p>
        )}
        {!chabadEnabled && (
          <p className="text-meta text-ink-soft">
            Chabad.org isn&rsquo;t turned on for this deployment, so searching won&rsquo;t work yet.
          </p>
        )}

        {/* The stored answer, as text. Same reasoning as the address
            lookup's summary: what shows is what the location IS, not the
            id it happens to be stored as. */}
        {chosen && (
          <p className="text-body text-ink">
            {chosen.title}
            <span className="text-meta text-ink-soft">
              {" "}
              — Chabad.org location {chosen.value}
              {chosen.type === "2" ? " (a US ZIP)" : ""}
            </span>
          </p>
        )}

        <div className="flex items-end gap-2">
          <Field
            id="chabadCityQuery"
            label="City"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // A stale result under a changed query reads as if it
              // answered the new one.
              setSearch({ status: "idle" });
              setCheck({ status: "idle" });
            }}
            placeholder="Lugano"
            hint="Chabad.org's own list of places. Search for the nearest city if the shul's town isn't listed."
            autoComplete="off"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={searching || !query.trim() || !chabadEnabled}
            onClick={() =>
              startSearch(async () => {
                setCheck({ status: "idle" });
                setSearch(await searchChabadCity(query));
              })
            }
          >
            {searching ? "Searching" : "Search"}
          </Button>
        </div>

        {search.status === "failed" && <p className="text-meta text-offline">{search.message}</p>}

        {search.status === "found" && (
          <div className="flex flex-col gap-2">
            {/*
              A PICK-LIST, because the number of matches is not known. The
              one hand-verified query returned a single suggestion, and
              nobody has established what an ambiguous city returns — see
              lib/zmanim/chabad-locations.ts. So this renders whatever came
              back as a list of choices rather than auto-selecting a first
              result, which would silently pick a Springfield.
            */}
            {search.suggestions.map((suggestion) => {
              const isChosen = chosen?.value === suggestion.value && chosen?.type === suggestion.type;
              return (
                <div key={`${suggestion.type}-${suggestion.value}`} className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={checking || isChosen}
                    onClick={() =>
                      startCheck(async () => {
                        const outcome = await checkChabadCity(
                          suggestion.value,
                          suggestion.type,
                          suggestion.title,
                        );
                        setCheck(outcome);
                        // ONLY A CONFIRMED FETCH SETS THE FIELDS. A
                        // suggestion whose id serves another city fails
                        // verification server-side, and nothing is chosen —
                        // which is the whole point of confirming rather
                        // than picking.
                        if (outcome.status === "confirmed") {
                          setChosen({
                            value: suggestion.value,
                            type: suggestion.type,
                            title: suggestion.title,
                          });
                        }
                      })
                    }
                  >
                    {isChosen ? "Chosen" : checking ? "Checking" : "Use this"}
                  </Button>
                  <span className="text-body text-ink">{suggestion.title}</span>
                  {suggestion.type === "2" && <span className="text-meta text-ink-soft">US ZIP</span>}
                </div>
              );
            })}
            {search.truncated && (
              <p className="text-meta text-ink-soft">
                Only the first twenty are shown. Narrow the search if the right one isn&rsquo;t here.
              </p>
            )}
          </div>
        )}

        {check.status === "failed" && <p className="text-meta text-offline">{check.message}</p>}

        {check.status === "confirmed" && (
          <div className="flex flex-col gap-1">
            {/*
              WHAT CHABAD.ORG ITSELF SAYS, not what was asked for. The name
              here comes out of the zmanim response, so it is the
              verification made visible, and the time is Chabad's own
              rendered string for that place — the two things a gabbai can
              actually judge.
            */}
            <p className="text-body text-ink">Chabad.org has this as {check.locationName}.</p>
            {check.candleLighting && check.candleLightingWhen ? (
              <p className="text-meta text-ink-soft">
                Candle lighting there {check.candleLightingWhen} is{" "}
                <span className="numeric font-semibold">{check.candleLighting}</span>. Save to use it.
              </p>
            ) : (
              <p className="text-meta text-ink-soft">
                No candle lighting in the next week to check it against — the location resolved, though. Save to
                use it.
              </p>
            )}
          </div>
        )}

        {/*
          Hidden inputs rather than conditional rendering, and empty
          strings rather than omission when nothing is chosen: the server
          reads all three names and clears the stored location when they
          are blank, so a gabbai who clears this can actually clear it.
        */}
        <input type="hidden" name="zmanimLocationId" value={chosen?.value ?? ""} />
        <input type="hidden" name="zmanimLocationType" value={chosen?.type ?? ""} />
        <input type="hidden" name="zmanimLocationName" value={chosen?.title ?? ""} />

        {chosen && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setChosen(null);
              setCheck({ status: "idle" });
            }}
          >
            Clear this city
          </Button>
        )}
      </div>
    </details>
  );
}
