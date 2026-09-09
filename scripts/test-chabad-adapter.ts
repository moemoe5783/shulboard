/**
 * lib/zmanim/chabad-adapter.ts's own parsing logic, against a stubbed
 * `fetch` — no network, and no recorded real chabad.org response either.
 *
 * ORIGIN OF THE FIXTURES BELOW: self-authored, by hand, to match the
 * Days/TimeGroups/Items shape and field names (`Name`, `Time`, the ASP.NET
 * `/Date(...)/` encoding) that chabad-adapter.ts's own header comment
 * already flags as reconstructed from a third-party client
 * (`chabad-org-zmanim` on npm) rather than confirmed against a live
 * response. This suite proves the adapter's PARSING LOGIC is internally
 * consistent and fails safe on the shape it expects — it does not, and
 * cannot from this sandbox, prove that shape matches chabad.org's real
 * payload. Verify against one real response (see that file's header)
 * before ZMANIM_CHABAD_ENABLED ever gets turned on for a real shul.
 *
 * Run with: npm run test:chabad-adapter — not plain `node`. The module
 * under test imports `server-only`, which throws unless the `react-server`
 * export condition is set (Next's own server build sets it; a plain `node`
 * run needs `--conditions=react-server` — see the npm script).
 */

import { fetchChabadZmanim } from "../lib/zmanim/chabad-adapter.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** ASP.NET's own date encoding — the exact format parseAspNetDate exists
 *  to unwrap, not a plain ISO string. */
const aspNetDate = (date: Date) => `/Date(${date.getTime()})/`;

const FRIDAY = new Date("2026-07-10T00:00:00.000Z");
const CANDLE_LIGHTING_TIME = new Date("2026-07-11T00:10:00.000Z");
const SATURDAY = new Date("2026-07-11T00:00:00.000Z");

function stubFetch(body: unknown) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  })) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const REQUEST = {
  locationId: "11213",
  locationType: "2" as const,
  startDate: "2026-07-10",
  endDate: "2026-07-12",
  timeZone: "America/New_York",
};

// ---- a day whose TimeGroups include a matching item ----------------------

{
  const body = {
    Days: [
      {
        Date: aspNetDate(FRIDAY),
        TimeGroups: [
          {
            Items: [
              { Name: "Shkiah", Time: aspNetDate(new Date("2026-07-11T00:28:00.000Z")) },
              { Name: "Candle Lighting", Time: aspNetDate(CANDLE_LIGHTING_TIME) },
            ],
          },
        ],
      },
    ],
  };

  const restore = stubFetch(body);
  const { times, rawResponseByDate } = await fetchChabadZmanim(REQUEST);
  restore();

  const friday = times["2026-07-10"];
  check(friday?.candle_lighting?.iso === CANDLE_LIGHTING_TIME.toISOString(),
    "a matching item's iso value round-trips exactly, unrounded",
    friday?.candle_lighting?.iso);
  check(friday?.candle_lighting?.display === "8:10 PM",
    "display is rendered in the requested timezone, 12-hour",
    friday?.candle_lighting?.display);
  check(!("Shkiah" in (friday ?? {})), "a non-candle-lighting item in the same group is not carried into times");
  check(Object.keys(rawResponseByDate).includes("2026-07-10"), "the raw per-day body is kept regardless of what parsed");
}

// ---- a day with no matching item — the isCandleLightingItem no-match path

{
  const body = {
    Days: [
      {
        Date: aspNetDate(SATURDAY),
        TimeGroups: [
          {
            Items: [
              { Name: "Shkiah", Time: aspNetDate(new Date("2026-07-12T00:27:00.000Z")) },
              { Name: "Havdalah", Time: aspNetDate(new Date("2026-07-12T01:17:00.000Z")) },
            ],
          },
        ],
      },
    ],
  };

  const restore = stubFetch(body);
  const { times, rawResponseByDate } = await fetchChabadZmanim(REQUEST);
  restore();

  // The exact question this block exists to answer: does a day with
  // nothing matching "candle" in any item's label throw, write a
  // malformed/partial entry, or simply never appear in `times`?
  check(!("2026-07-11" in times), "a day with no matching item is absent from times entirely — not present as {}, not thrown");
  check(Object.keys(rawResponseByDate).includes("2026-07-11"),
    "the raw body is still kept for that day, so a real shape mismatch stays diagnosable");
}

// ---- malformed / missing fields degrade rather than throw ----------------

{
  const body = {
    Days: [
      { Date: "not a real date", TimeGroups: [{ Items: [{ Name: "Candle Lighting", Time: aspNetDate(FRIDAY) }] }] },
      { Date: aspNetDate(SATURDAY), TimeGroups: "not an array" },
      { Date: aspNetDate(new Date("2026-07-12T00:00:00.000Z")), TimeGroups: [{ Items: [{ Name: "Candle Lighting" }] }] },
    ],
  };

  const restore = stubFetch(body);
  let threw = false;
  let result: Awaited<ReturnType<typeof fetchChabadZmanim>> | undefined;
  try {
    result = await fetchChabadZmanim(REQUEST);
  } catch {
    threw = true;
  }
  restore();

  check(!threw, "an unparseable day date, a non-array TimeGroups, and a matching item with no time all degrade rather than throw");
  check(result !== undefined && Object.keys(result.times).length === 0,
    "none of the three malformed days produced a times entry", JSON.stringify(result?.times));
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
