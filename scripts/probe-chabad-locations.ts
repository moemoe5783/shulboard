/**
 * DIAGNOSTIC, NOT A TEST. Makes real requests to chabad.org, so it is
 * deliberately not part of `npm test` and not run in CI. This project's
 * sandbox cannot run it either — the egress proxy refuses CONNECT to
 * www.chabad.org — so it exists to be run somewhere the network works.
 *
 * WHAT IT ANSWERS. `Get_Locations` has been observed exactly once, for one
 * query, returning one suggestion:
 *
 *   ?location=Lugano
 *   -> {"Suggestions":[{"Title":"Lugano,  Switzerland","Value":"872","ItemType":"1"}]}
 *
 * Everything else about its behaviour is unknown, and the reader
 * (lib/zmanim/chabad-locations.ts) is written to assume none of it. These
 * are the questions that actually change how the settings UI should behave,
 * so this prints the raw body for each rather than a summary:
 *
 *  - AN AMBIGUOUS CITY. "Springfield" and "London" exist in several
 *    countries. Does the endpoint return many suggestions, or one? Are they
 *    ordered usefully? Is a US result's `ItemType` "2" with a ZIP in
 *    `Value`, which is the case that would silently query the wrong place
 *    if anything hardcoded "1"?
 *  - A MISSPELLING. "Lugana", "Mancheter". Fuzzy match, empty
 *    `Suggestions`, or a 200 with no `Suggestions` key at all? The reader
 *    treats the last of those as a shape error rather than as "no matches",
 *    on purpose, and this is how to find out which it is.
 *  - A PLACE WITH NO CHABAD PRESENCE. Somewhere real that Chabad has no
 *    centre in. Does the endpoint answer for any place, or only for places
 *    in its own directory? The answer decides whether a shul in a small
 *    town has to search for the nearest city — which is what the settings
 *    copy should say — or can search for itself.
 *  - A ONE-LETTER AND AN EMPTY QUERY. Whether it floods, and whether
 *    MAX_SUGGESTIONS in the reader is doing real work.
 *
 * Run it where the network works:
 *   npm run probe:chabad-locations
 *   npm run probe:chabad-locations -- Lugano "Bnei Brak"
 *
 * Report the raw bodies. The single-result shape is not yet a contract.
 */

import { searchChabadLocations } from "../lib/zmanim/chabad-locations.ts";

const ENDPOINT = "https://www.chabad.org/WebServices/RemoteCall/Get_Locations";

const QUERIES =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [
        // The one hand-verified query — the control. If this comes back
        // differently from the shape above, nothing else here means much.
        "Lugano",
        // Ambiguous: several countries.
        "Springfield",
        "London",
        // Ambiguous within one country, and a likely ItemType "2" case.
        "Brooklyn",
        // Misspellings.
        "Lugana",
        "Mancheter",
        // Real places Chabad is unlikely to list.
        "Kettleburgh",
        "Wamsutter",
        // Degenerate.
        "L",
        "",
      ];

for (const query of QUERIES) {
  console.log(`\n=== ${JSON.stringify(query)} ${"=".repeat(Math.max(0, 40 - query.length))}`);

  // The raw body first, verbatim and untouched — this is the part worth
  // reporting, and the reader's own view of it is only useful next to it.
  const url = new URL(ENDPOINT);
  url.searchParams.set("location", query);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const raw = await response.text();
    console.log(`  HTTP ${response.status} ${response.statusText}, ${raw.length} bytes`);
    console.log(`  raw: ${raw.length > 2000 ? raw.slice(0, 2000) + " …(truncated)" : raw}`);
  } catch (cause) {
    console.log(`  raw fetch threw: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  // Then what the reader makes of it, so a disagreement between the two is
  // visible rather than inferred.
  const outcome = await searchChabadLocations(query);
  if (!outcome.ok) {
    console.log(`  reader: ${outcome.reason} — ${outcome.message}`);
    continue;
  }
  console.log(
    `  reader: ${outcome.suggestions.length} usable, ${outcome.dropped} dropped` +
      `${outcome.truncated ? ", TRUNCATED" : ""}`,
  );
  for (const suggestion of outcome.suggestions) {
    console.log(
      `    type ${suggestion.type}  value ${JSON.stringify(suggestion.value)}  ` +
        `title ${JSON.stringify(suggestion.title)}` +
        (suggestion.title === suggestion.rawTitle ? "" : `  (raw ${JSON.stringify(suggestion.rawTitle)})`),
    );
  }
}
