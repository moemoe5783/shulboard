/**
 * DIAGNOSTIC, NOT A TEST. Makes real requests to chabad.org, so it is
 * deliberately not part of `npm test` and not run in CI.
 *
 * WHY IT EXISTS: a live 91-day warm for ZIP 33710 returned 91 days and zero
 * candle-lighting times. Two hypotheses survive code reading, and telling
 * them apart needs live calls this project's own sandbox cannot make (the
 * egress proxy refuses CONNECT to www.chabad.org):
 *
 *   A. THE DATE FORMAT. The adapter sends ISO (`2026-09-10`) for `tdate`,
 *      `startdate` and `enddate`. The hand-verified working request uses
 *      M-D-YYYY for `tdate` and M/D/YYYY for the other two.
 *   B. THE tdate DAY. Candle lighting may be emitted only for the single
 *      day `tdate` names rather than for every candle-lighting day in the
 *      range. The working request set `tdate` to 9-11-2026 — a Friday, and
 *      the only day in that response carrying a CandleLighting. The failing
 *      warm set it to the window's first day, a Wednesday.
 *
 * If B holds, no date-format fix helps and one wide request can never
 * return more than one candle lighting: the window has to be walked.
 *
 * Run it where the network works:
 *   npm run probe:chabad            # ZIP 33710
 *   npm run probe:chabad -- 11213   # any US ZIP
 *
 * Read the table it prints. `clDates` is the answer: candle lighting on
 * every Friday in the range means the response is fine and the bug is
 * elsewhere; candle lighting only on the tdate day confirms B.
 */

import { fetchChabadZmanim } from "../lib/zmanim/chabad-adapter.ts";

const ENDPOINT = "https://www.chabad.org/webservices/zmanim/zmanim/Get_Zmanim";
const zip = process.argv[2] ?? "33710";
const timeZone = "America/New_York";

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** M/D/YYYY. `URLSearchParams.set` encodes the slashes to %2F on its own,
 *  which is byte-for-byte what the working request carries. */
const us = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
/** M-D-YYYY, the working request's `tdate` spelling. */
const usDashed = (d: Date) => `${d.getUTCMonth() + 1}-${d.getUTCDate()}-${d.getUTCFullYear()}`;

const today = new Date(`${iso(new Date())}T00:00:00Z`);
const plus = (days: number) => new Date(today.getTime() + days * 86_400_000);
const weekday = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

/** The next Friday at or after `today` — the day hypothesis B says `tdate`
 *  has to name for candle lighting to appear at all. */
function nextFriday(): Date {
  for (let i = 0; i < 8; i += 1) {
    const day = plus(i);
    if (day.getUTCDay() === 5) return day;
  }
  throw new Error("unreachable: eight days always contain a Friday");
}

type Summary = {
  days: number;
  first: unknown;
  last: unknown;
  bytes: number;
  types: string[];
  clDates: unknown[];
};

function summarise(body: unknown, bytes: number): Summary {
  const record = (body ?? {}) as Record<string, unknown>;
  const days = Array.isArray(record.Days) ? record.Days : [];
  const types = new Set<string>();
  const clDates: unknown[] = [];

  for (const day of days) {
    const dayRecord = (day ?? {}) as Record<string, unknown>;
    let hasCl = false;
    for (const group of Array.isArray(dayRecord.TimeGroups) ? dayRecord.TimeGroups : []) {
      for (const item of Array.isArray((group as Record<string, unknown>)?.Items)
        ? ((group as Record<string, unknown>).Items as unknown[])
        : []) {
        const type = (item as Record<string, unknown>)?.ZmanType;
        if (typeof type !== "string") continue;
        types.add(type);
        if (type === "CandleLighting") hasCl = true;
      }
    }
    if (hasCl) clDates.push(dayRecord.DisplayDate);
  }

  return {
    days: days.length,
    first: (days[0] as Record<string, unknown>)?.DisplayDate ?? null,
    last: (days[days.length - 1] as Record<string, unknown>)?.DisplayDate ?? null,
    bytes,
    types: [...types].sort(),
    clDates,
  };
}

/** A raw request built here rather than by the adapter, so the date format
 *  can be varied. Labelled as such in the output — the adapter's own path
 *  is exercised separately below, unmodified. */
async function raw(label: string, tdate: string, startdate: string, enddate: string) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("locationid", zip);
  url.searchParams.set("locationtype", "2");
  url.searchParams.set("save", "1");
  url.searchParams.set("tdate", tdate);
  url.searchParams.set("jewish", "Zmanim-Halachic-Times.htm");
  url.searchParams.set("startdate", startdate);
  url.searchParams.set("enddate", enddate);

  console.log(`\n=== ${label}`);
  console.log(url.toString());
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await response.text();
    if (!response.ok) {
      console.log(`  HTTP ${response.status} ${response.statusText}, ${text.length} bytes`);
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      console.log(`  200 but unparseable, ${text.length} bytes, starts: ${JSON.stringify(text.slice(0, 160))}`);
      return;
    }
    const s = summarise(body, text.length);
    console.log(`  ${s.days} days (${s.first} .. ${s.last}), ${s.bytes} bytes`);
    console.log(`  ZmanTypes: ${s.types.join(", ") || "(none)"}`);
    console.log(`  CandleLighting on: ${s.clDates.length ? s.clDates.join(", ") : "NONE"}`);
  } catch (cause) {
    console.log(`  request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

console.log(`ZIP ${zip}, today ${iso(today)} (${weekday(today)}), timezone ${timeZone}`);
console.log(`next Friday: ${iso(nextFriday())}`);

// ---- item 3: does the WINDOW SIZE matter? -------------------------------
// The code's own construction (ISO dates, tdate = first day of the window),
// at the three sizes. Serially — the free-tier-ish courtesy this project
// owes an endpoint it has no ToS with.
for (const span of [3, 29, 90]) {
  await raw(
    `WINDOW ${span + 1} days — ISO dates, tdate = first day (${weekday(today)}), exactly what the code sends`,
    iso(today),
    iso(today),
    iso(plus(span)),
  );
}

// ---- item 2: does the DATE FORMAT matter? ------------------------------
// Same 4-day window, the working request's own formats.
await raw(
  "FORMAT 4 days — M-D-YYYY tdate + M/D/YYYY range, the hand-verified working spelling",
  usDashed(today),
  us(today),
  us(plus(3)),
);

// ---- hypothesis B: does tdate have to name a candle-lighting day? ------
// A wide window, US formats, tdate pointed at the next Friday instead of
// at the window's first day. If candle lighting appears here and not above,
// tdate is the variable that matters and the fix is to walk the window.
await raw(
  `tdate = next Friday (${iso(nextFriday())}), 91-day window, US formats`,
  usDashed(nextFriday()),
  us(today),
  us(plus(90)),
);

// ---- and the adapter's own unmodified path, for the record -------------
console.log("\n=== THE ADAPTER'S OWN PATH, unmodified (91 days) — watch for its [chabad-zmanim] log line");
try {
  const { times } = await fetchChabadZmanim({
    locationId: zip,
    locationType: "2",
    startDate: iso(today),
    endDate: iso(plus(90)),
    timeZone,
  });
  const withCl = Object.keys(times).filter((date) => times[date]?.candle_lighting);
  console.log(`  parsed candle lighting on: ${withCl.length ? withCl.join(", ") : "NONE"}`);
} catch (cause) {
  console.log(`  threw: ${cause instanceof Error ? cause.message : String(cause)}`);
}
