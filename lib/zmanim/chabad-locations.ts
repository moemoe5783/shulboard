import "server-only";

/*
 * Chabad.org's public location search — the thing that unblocks non-US
 * shuls.
 *
 * `Get_Locations?location=<query>` resolves a place name to Chabad's own
 * opaque location id, which is exactly what a shul with no US ZIP had no
 * way to obtain: `locationtype=1` was passed through by the zmanim adapter
 * and unusable, because the only way to get an id was for a gabbai to dig
 * one out of a chabad.org URL by hand.
 *
 * Verified by hand, one query:
 *   ?location=Lugano
 *   -> {"Suggestions":[{"Title":"Lugano,  Switzerland","Value":"872","ItemType":"1"}]}
 * and `locationid=872&locationtype=1` then works on the existing zmanim
 * call unchanged.
 *
 * ITS OWN MODULE, not a function in lib/geocoding/ and not in
 * lib/zmanim/location.ts. Three boundaries, and this fits none of them:
 * `lib/geocoding/` is the LocationIQ boundary and carries that provider's
 * key, quota and link-back licence condition, none of which apply here;
 * `lib/zmanim/location.ts` is client-safe pure resolution with no fetch;
 * and this is a Chabad surface, so it sits beside the other two Chabad
 * readers where a future session looking for "what do we call at
 * chabad.org" will find it.
 *
 * NOTHING BELOW ASSUMES THE SINGLE-RESULT SHAPE ABOVE, and that is
 * deliberate rather than defensive habit: the multi-result behaviour has
 * not been observed by anyone. The one hand-verified query returned one
 * suggestion; what an ambiguous city, a misspelling or a place with no
 * Chabad presence returns is unknown (this project's sandbox cannot reach
 * chabad.org at all — the egress proxy refuses CONNECT — and the person
 * who can was served a cached response). So `Suggestions` may be absent,
 * not an array, empty, or hold many; an entry may be missing any field or
 * carry a type nobody has seen. Every one of those is handled here and
 * counted, rather than crashing a settings page or silently producing a
 * location id that isn't one. scripts/probe-chabad-locations.ts is the
 * script to run where the network works.
 */

const ENDPOINT = "https://www.chabad.org/WebServices/RemoteCall/Get_Locations";

/** Long enough for a slow endpoint, short enough that a gabbai doesn't sit
 *  on a spinner wondering whether the button worked. Same number
 *  lib/geocoding/locationiq.ts uses, for the same reason. */
const TIMEOUT_MS = 8000;

/**
 * How many suggestions to keep. A broad query ("Springfield", "London")
 * could return a long list, and a pick-list nobody can scan is not a
 * pick-list. The count of what was cut is reported so the UI can say
 * "narrow the search" rather than silently showing the first twenty of an
 * unknown number.
 */
const MAX_SUGGESTIONS = 20;

export type ChabadLocationSuggestion = {
  /** Chabad's `Value` — the `locationid`. Kept EXACTLY as served: it is an
   *  opaque identifier and this project has no business trimming,
   *  re-casing or zero-padding it. */
  value: string;
  /**
   * Chabad's `ItemType` — the `locationtype`.
   *
   * NEVER DEFAULTED AND NEVER COERCED. A search may return `"2"` for a US
   * result, where the `Value` is a ZIP rather than a city id, and assuming
   * `"1"` for anything found by name would silently query a different
   * place. An entry whose `ItemType` is neither `"1"` nor `"2"` is dropped
   * rather than guessed at — see `readSuggestion`.
   */
  type: "1" | "2";
  /**
   * The display line, whitespace-normalized: "Lugano,  Switzerland" comes
   * back with two spaces after the comma and renders with two spaces in
   * HTML only by accident of collapsing. Normalized so it reads right
   * everywhere it is used — a pick-list, a confirmation line, a stored
   * name — and because it is compared against the zmanim response's own
   * `LocationName` (lib/zmanim/chabad-adapter.ts), where irregular
   * internal whitespace would be a false mismatch.
   *
   * `value` is deliberately NOT normalized alongside it.
   */
  title: string;
  /** The title exactly as served. Kept so a log line can show what was
   *  actually returned when a normalization question comes up, rather than
   *  showing this project's cleaned-up version of it. */
  rawTitle: string;
};

export type ChabadLocationSearch =
  | {
      ok: true;
      suggestions: ChabadLocationSuggestion[];
      /** Entries the response carried that this could not read — a missing
       *  `Value`, an `ItemType` nobody has seen. Non-zero is a shape change
       *  worth a log line, not a user-facing error: the readable ones are
       *  still returned. */
      dropped: number;
      /** True when the response held more than `MAX_SUGGESTIONS`, so the UI
       *  can say the list is cut rather than implying it is complete. */
      truncated: boolean;
    }
  | { ok: false; reason: "empty-query" | "not-found" | "unavailable"; message: string };

/** Collapses runs of whitespace, including the non-breaking spaces
 *  chabad.org uses liberally elsewhere, and trims. */
function normalizeTitle(value: string): string {
  return value.replace(/[\s ]+/g, " ").trim();
}

/**
 * One `Suggestions` entry, or null if it cannot be used.
 *
 * A dropped entry is not an error and not a crash: the rest of the list is
 * still good, and a settings page that fails entirely because chabad.org
 * added a third `ItemType` would be worse than one that shows the two
 * kinds it understands.
 */
function readSuggestion(candidate: unknown): ChabadLocationSuggestion | null {
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;

  const value = typeof record.Value === "string" ? record.Value.trim() : "";
  const rawTitle = typeof record.Title === "string" ? record.Title : "";
  const type = typeof record.ItemType === "string" ? record.ItemType.trim() : "";

  if (!value || !rawTitle.trim()) return null;
  // The exhaustive test, not a fallback. See `type` above.
  if (type !== "1" && type !== "2") return null;

  return { value, type, title: normalizeTitle(rawTitle), rawTitle };
}

/**
 * Places matching a free-text query, as Chabad.org's own suggestions.
 *
 * Never throws: every caller reports an outcome rather than a stack trace,
 * the same contract `lib/geocoding/locationiq.ts` holds to and for the same
 * reason — this is behind a button a gabbai presses, and a thrown error
 * there is a blank page.
 *
 * LOWERCASE `location`, like every other chabad.org parameter this project
 * sends. Their query parameter names are case-sensitive and fail silently:
 * the zmanim endpoint ignores `locationId` and serves Brooklyn with no
 * error at all (lib/zmanim/chabad-adapter.ts's note). Nobody has tested
 * what this endpoint does with `Location`, and nobody should have to.
 *
 * No `aid` parameter — confirmed unnecessary, same as the zmanim call.
 */
export async function searchChabadLocations(query: string): Promise<ChabadLocationSearch> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty-query", message: "Type a city to search for." };
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("location", trimmed);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "Couldn't reach Chabad.org just now. Try again in a moment.",
    };
  }

  if (!response.ok) {
    console.error(`[chabad-locations] ${response.status} ${response.statusText} for ${url.toString()}`);
    return {
      ok: false,
      reason: "unavailable",
      message: `Chabad.org's location search answered ${response.status}. Try again in a moment.`,
    };
  }

  // Read as text and parse here, for the reason the zmanim adapter does:
  // a body that isn't JSON becomes a diagnosable log line with a snippet
  // rather than an opaque throw, and the byte length is worth having.
  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    console.error(
      `[chabad-locations] 200 but unparseable body, ${raw.length} bytes, for ${url.toString()} — ` +
        `starts: ${JSON.stringify(raw.slice(0, 200))}`,
    );
    return {
      ok: false,
      reason: "unavailable",
      message: "Chabad.org's location search returned something this app couldn't read.",
    };
  }

  const entries = Array.isArray((body as { Suggestions?: unknown })?.Suggestions)
    ? ((body as { Suggestions: unknown[] }).Suggestions)
    : null;

  if (entries === null) {
    // A 200 with no `Suggestions` array at all. Not "no matches" — the
    // shape is wrong, and calling it not-found would hide a changed
    // response behind a message telling the gabbai to try another city.
    console.error(
      `[chabad-locations] 200 with no Suggestions array for ${url.toString()} — ` +
        `keys: ${JSON.stringify(Object.keys((body ?? {}) as object).slice(0, 10))}`,
    );
    return {
      ok: false,
      reason: "unavailable",
      message: "Chabad.org's location search returned an unexpected answer.",
    };
  }

  const readable: ChabadLocationSuggestion[] = [];
  let dropped = 0;
  for (const entry of entries) {
    const suggestion = readSuggestion(entry);
    if (suggestion) readable.push(suggestion);
    else dropped += 1;
  }

  if (readable.length === 0) {
    // Genuinely nothing usable. An empty array and an array of entries
    // this cannot read reach the same message on purpose — from where the
    // gabbai stands they are the same thing, "search for somewhere else" —
    // but `dropped` is logged so the two are distinguishable afterwards.
    console.info(
      `[chabad-locations] ${JSON.stringify({ query: trimmed, entries: entries.length, dropped })}`,
    );
    return {
      ok: false,
      reason: "not-found",
      message: `Chabad.org has no location matching “${trimmed}”. Try the nearest larger city.`,
    };
  }

  if (dropped > 0) {
    console.error(
      `[chabad-locations] dropped ${dropped} of ${entries.length} suggestions for “${trimmed}” — ` +
        "unreadable shape or an ItemType other than 1 or 2",
    );
  }

  return {
    ok: true,
    suggestions: readable.slice(0, MAX_SUGGESTIONS),
    dropped,
    truncated: readable.length > MAX_SUGGESTIONS,
  };
}
