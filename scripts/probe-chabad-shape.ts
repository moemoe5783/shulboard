/**
 * DIAGNOSTIC, NOT A TEST. Makes real requests to chabad.org, so it is
 * deliberately not part of `npm test` and not run in CI. This project's
 * sandbox cannot run it — the egress proxy refuses CONNECT to
 * www.chabad.org — so it exists to be run somewhere the network works.
 *
 * THE QUESTION: WHICH PARAMETER DECIDES THE PER-DAY SHAPE, and therefore
 * whether Hebrew zman names are available at all.
 *
 * Two captures exist and they disagree:
 *
 *   FLAT — a 92-day request with the full parameter set returned
 *   `Days[].Zmanim[]`: one entry per zman, `EssentialZmanType` / `Zman` /
 *   `FootnoteType`, and NO Hebrew anywhere.
 *
 *   NESTED — a 4-day request returned `Days[].TimeGroups[].Items[]`, each
 *   group carrying `HebrewTitle` ("עלות השחר"), `EssentialTitle`,
 *   `OpinionInformation` ("Alter Rebbe (Default)") and
 *   `TechnicalInformation` ("16.9 degrees below horizon") — none of which
 *   the flat shape has.
 *
 * Their roots are structurally identical: the same sixteen keys,
 * `IsAdvanced: false` in both. So it is a per-DAY difference, which rules
 * out a whole-response "advanced" mode and leaves two hypotheses:
 *
 *   A. ONE OF THE FOUR TRAILING PARAMETERS. `before`, `after`,
 *      `ShabbosEnds`, `bdef` were added to fix a request that returned zero
 *      candle-lighting times, and the nested capture predates them.
 *      `bdef` is the likeliest by name — "brief default"?
 *   B. THE RANGE LENGTH. A 92-day nested response would be enormous (14
 *      groups × items × 92 days), and an endpoint trimming to a lean shape
 *      for long ranges is exactly what these two captures look like.
 *
 * The two have very different consequences. If A, the full parameter set
 * can be adjusted to get Hebrew for the whole 92-day window. If B, the
 * 92-day warm can never carry Hebrew — and the answer is then a SECOND,
 * tiny request per warm purely to harvest the names, which is cheap
 * because Hebrew titles do not vary by location and barely vary by date
 * (`ShabbatEndTime` is the one that does — see the adapter).
 *
 * Run it where the network works:
 *   npm run probe:chabad-shape
 *   npm run probe:chabad-shape -- 11213
 *
 * Report the SHAPE column. That is the whole finding.
 */

// Top-level await needs this file to be a module, and it imports nothing.
export {};

const ENDPOINT = "https://www.chabad.org/webservices/zmanim/zmanim/Get_Zmanim";
const zip = process.argv[2] ?? "33710";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date(`${iso(new Date())}T00:00:00Z`);
const plus = (days: number) => new Date(today.getTime() + days * 86_400_000);
const dash = (d: Date) => `${d.getUTCMonth() + 1}-${d.getUTCDate()}-${d.getUTCFullYear()}`;
const slash = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;

/** The full parameter set the adapter sends, as a base to vary from.
 *  Lowercase throughout except `ShabbosEnds`, which is genuinely
 *  mixed-case in the verified request — see the adapter's note. */
function baseParams(days: number): Record<string, string> {
  return {
    locationid: zip,
    locationtype: "2",
    save: "1",
    tdate: dash(today),
    jewish: "Zmanim-Halachic-Times.htm",
    startdate: slash(today),
    enddate: slash(plus(days - 1)),
    before: "18",
    after: "42",
    ShabbosEnds: "1",
    bdef: "0",
  };
}

/** Which per-day shape came back, and whether it carried Hebrew. */
function describe(body: unknown): string {
  const days = Array.isArray((body as { Days?: unknown[] })?.Days) ? (body as { Days: unknown[] }).Days : [];
  if (days.length === 0) return "no Days at all";

  const first = (days[1] ?? days[0]) as Record<string, unknown>;
  const nested = Array.isArray(first?.TimeGroups) ? (first.TimeGroups as unknown[]) : null;
  const flat = Array.isArray(first?.Zmanim) ? (first.Zmanim as unknown[]) : null;

  let hebrew = 0;
  for (const rawGroup of nested ?? []) {
    if (typeof (rawGroup as Record<string, unknown>)?.HebrewTitle === "string") hebrew += 1;
  }

  const shape = nested ? `NESTED (${nested.length} groups, ${hebrew} with HebrewTitle)` : flat ? `flat (${flat.length} entries, no Hebrew)` : "neither";
  return `${days.length} days, ${shape}`;
}

/*
 * Each case varies ONE thing from the full parameter set, so a difference
 * is attributable. The range-length cases come last because they are the
 * hypothesis that would cost the most to be true.
 */
const CASES: { label: string; params: Record<string, string | null>; days: number }[] = [
  { label: "the full set, 92 days (what production sends)", params: {}, days: 92 },
  { label: "the full set, 4 days (the nested capture's range)", params: {}, days: 4 },
  { label: "bdef=1", params: { bdef: "1" }, days: 4 },
  { label: "bdef dropped", params: { bdef: null }, days: 4 },
  { label: "ShabbosEnds dropped", params: { ShabbosEnds: null }, days: 4 },
  { label: "before/after dropped", params: { before: null, after: null }, days: 4 },
  { label: "all four trailing params dropped", params: { before: null, after: null, ShabbosEnds: null, bdef: null }, days: 4 },
  { label: "bdef dropped, 92 days", params: { bdef: null }, days: 92 },
  { label: "the full set, 30 days", params: {}, days: 30 },
  { label: "the full set, 8 days", params: {}, days: 8 },
];

console.log(`ZIP ${zip}, from ${iso(today)}\n`);

for (const testCase of CASES) {
  const params = { ...baseParams(testCase.days) };
  for (const [key, value] of Object.entries(testCase.params)) {
    if (value === null) delete params[key];
    else params[key] = value;
  }

  const url = new URL(ENDPOINT);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  process.stdout.write(`${testCase.label.padEnd(48)} `);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const raw = await response.text();
    if (!response.ok) {
      console.log(`HTTP ${response.status}`);
      continue;
    }
    console.log(`${String(raw.length).padStart(7)} bytes  ${describe(JSON.parse(raw))}`);
  } catch (cause) {
    console.log(`threw: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

console.log(
  "\nIf any NESTED row also says 92 days, hypothesis A holds and the full parameter set can be adjusted." +
    "\nIf NESTED only ever appears on short ranges, hypothesis B holds and Hebrew needs a second small request per warm.",
);
