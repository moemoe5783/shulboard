/**
 * lib/zmanim/resolve-zmanim.ts — the Zmanim widget's whole decision layer,
 * driven directly rather than through a rendered component.
 *
 * THE CACHE IS THE REAL ONE. It is loaded out of
 * test/fixtures/chabad-zmanim-33701-92day.json through the real
 * Get_Zmanim reader, which is the same code path that fills
 * `zmanim_cache` in production (lib/zmanim/warm.ts) — so the 17 days that
 * carry a Shabbos-end time instead of a nightfall are the real 17 days,
 * not a synthetic case shaped to make a substitution pass.
 *
 * Run with: npm run test:zmanim-widget — not plain `node`. Loading the
 * fixture through the adapter means importing a module that imports
 * `server-only`, which throws unless the `react-server` export condition
 * is set (see the npm script).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BoardLocation } from "../lib/board-location.tsx";
import { fetchChabadZmanim } from "../lib/zmanim/chabad-adapter.ts";
import { computeZman, HEBCAL_COMPUTABLE } from "../lib/zmanim/hebcal-zmanim.ts";
import { resolveZmanimForDate, resolveZmanimTable } from "../lib/zmanim/resolve-zmanim.ts";
import type { ChabadZmanimByDate } from "../lib/zmanim/resolve.ts";
import {
  CANONICAL_ZMAN_ORDER,
  CHABAD_SUPPLIES,
  ZMAN_PANEL_LABEL,
  ZMAN_SUBSTITUTE,
  isClockZman,
} from "../lib/zmanim/zman.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

// Saint Petersburg, FL — the fixture's own location, so a computed value
// and a cached one are directly comparable.
const LOCATION: BoardLocation = {
  latitude: 27.7723,
  longitude: -82.6386,
  timeZone: "America/New_York",
};

const FIXTURE_PATH = fileURLToPath(new URL("../test/fixtures/chabad-zmanim-33701-92day.json", import.meta.url));
const FIXTURE = readFileSync(FIXTURE_PATH, "utf8");

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => ({
  ok: true,
  status: 200,
  statusText: "OK",
  text: async () => FIXTURE,
})) as unknown as typeof fetch;
const { times: CACHE } = await fetchChabadZmanim({
  locationId: "33701",
  locationType: "2",
  startDate: "2026-09-10",
  endDate: "2026-12-10",
  timeZone: "America/New_York",
});
globalThis.fetch = originalFetch;

const DATES = Object.keys(CACHE).sort();
const base = {
  provider: "chabad" as const,
  location: LOCATION,
  chabadZmanim: CACHE as ChabadZmanimByDate,
  fallbackToCalculated: true,
  hour12: true,
};

console.log("\n-- the capability matrix is coherent -----------------------");

check(CHABAD_SUPPLIES.size === 14, "Chabad supplies 14 canonical ids", String(CHABAD_SUPPLIES.size));
check(
  [...CHABAD_SUPPLIES].every((id) => CANONICAL_ZMAN_ORDER.includes(id)),
  "every id Chabad supplies is one §5c names — nothing invented",
  [...CHABAD_SUPPLIES].filter((id) => !CANONICAL_ZMAN_ORDER.includes(id)).join(","),
);
check(
  CANONICAL_ZMAN_ORDER.every((id) => Boolean(ZMAN_PANEL_LABEL[id])),
  "every canonical id has a panel label, so no checkbox can render its raw id",
  CANONICAL_ZMAN_ORDER.filter((id) => !ZMAN_PANEL_LABEL[id]).join(","),
);
check(
  !CANONICAL_ZMAN_ORDER.some((id) => id.startsWith("chabad:")),
  "no provider-namespaced id is offered — chabad:ShaahZmanit stays out of board documents",
);
check(
  [...HEBCAL_COMPUTABLE].every((id) => CANONICAL_ZMAN_ORDER.includes(id)),
  "everything the fallback can compute is a canonical id too",
);
check(
  !HEBCAL_COMPUTABLE.has("candle_lighting") && !HEBCAL_COMPUTABLE.has("shabbos_ends"),
  "candle lighting and Shabbos ends are NOT computed here — that logic lives in the Candle Lighting widget",
);

console.log("\n-- the provider's own words reach the board ----------------");

{
  const rows = resolveZmanimForDate({ ...base, date: "2026-09-10", ids: ["netz", "sof_zman_tfila_baal_hatanya"] });
  check(rows[0]?.label === "Sunrise", "netz renders Chabad's \"Sunrise\", not our \"Netz\"", rows[0]?.label);
  check(
    rows[1]?.label === "Latest Shacharit",
    'sof_zman_tfila_baal_hatanya renders "Latest Shacharit", not "Sof zman tfila (Baal HaTanya)"',
    rows[1]?.label,
  );
  check(rows[0]?.display === "7:14 AM", "and the time is Chabad's own string, verbatim", rows[0]?.display);
  check(
    rows.every((row) => !row.fellBackToHebcal && row.suppliedBy === null),
    "cached rows are flagged as neither fallen back nor substituted",
  );
}

{
  // A Hebcal board has no cache and therefore no provider label. House
  // vocabulary is the fallback, and it is the only place it reaches a
  // board.
  const rows = resolveZmanimForDate({
    ...base,
    provider: "hebcal",
    chabadZmanim: null,
    date: "2026-09-10",
    ids: ["netz"],
  });
  check(rows[0]?.label === "Netz", "with no cache at all the label is ours", rows[0]?.label);
  check(rows[0]?.fellBackToHebcal === false, "and hebcal is not flagged as a fallback — it IS the computed path");
}

{
  // A Chabad board WITH a warmed cache keeps the provider's wording even
  // on a computed row, because a label doesn't vary by date and the
  // resolver harvests it from any date that has the id. Turning
  // "Calculate missing times" on must not change the words on screen.
  const thinned: ChabadZmanimByDate = { ...CACHE, "2026-09-10": {} };
  const rows = resolveZmanimForDate({ ...base, chabadZmanim: thinned, date: "2026-09-10", ids: ["netz"] });
  check(rows[0]?.fellBackToHebcal === true, "a Chabad row with nothing cached for the date is computed and flagged");
  check(
    rows[0]?.label === "Sunrise",
    "and it STILL says \"Sunrise\" — the label is harvested from the other 91 cached days",
    rows[0]?.label,
  );
}

console.log("\n-- ITEM 4: Tzeis and ShabbatEndTime are one nightfall ------");

// The 17 real days. Derived from the cache rather than typed out, so this
// asserts against whatever the fixture actually contains.
const shabbosEndDays = DATES.filter((date) => "shabbos_ends" in CACHE[date]);
const nightfallDays = DATES.filter((date) => "tzeis_baal_hatanya" in CACHE[date]);
check(shabbosEndDays.length === 17 && nightfallDays.length === 75,
  "17 days carry a Shabbos/Yom Tov end time, 75 carry a plain nightfall",
  `${shabbosEndDays.length} + ${nightfallDays.length}`);
check(
  shabbosEndDays.every((date) => !nightfallDays.includes(date)),
  "and no day carries both — Chabad publishes one nightfall and relabels it",
);

// THE BEHAVIOUR THIS TASK CALLS THE MOST IMPORTANT: a board configured for
// nightfall must not go blank on those 17 days.
{
  const blank: string[] = [];
  const substituted: string[] = [];
  for (const date of DATES) {
    const rows = resolveZmanimForDate({ ...base, date, ids: ["tzeis_baal_hatanya"] });
    if (rows.length === 0) blank.push(date);
    if (rows[0]?.suppliedBy === "shabbos_ends") substituted.push(date);
  }
  check(blank.length === 0, "a nightfall-only widget has a row on every one of the 92 days", blank.join(","));
  check(
    JSON.stringify(substituted) === JSON.stringify(shabbosEndDays),
    "and the substituted days are EXACTLY the 17 real Shabbos/Yom Tov days",
    `${substituted.length} substituted`,
  );
}

{
  // The substituted row carries the substitute's own label and value —
  // that relabel is the whole disclosure, so it has to actually happen.
  const rows = resolveZmanimForDate({ ...base, date: "2026-09-12", ids: ["tzeis_baal_hatanya"] });
  check(rows[0]?.label === "Shabbat Ends",
    "9/12 says \"Shabbat Ends\", never \"Nightfall\" over an 8.5° time", rows[0]?.label);
  check(rows[0]?.display === "8:14 PM", "and it is the Shabbos-end value, not a computed 6° one", rows[0]?.display);
  check(rows[0]?.id === "tzeis_baal_hatanya", "the row keeps the id the gabbai selected", rows[0]?.id);
  check(rows[0]?.fellBackToHebcal === false,
    "a substitution is not a fallback — nothing was calculated, so no indicator");
}

{
  // Substituting toward the stricter time only. Nightfall must never be
  // shown under a "Shabbos ends" row: 24-26 min after sunset against
  // 34-38 would tell a room Shabbos is over ten minutes early.
  check(
    Object.keys(ZMAN_SUBSTITUTE).length === 1 && ZMAN_SUBSTITUTE.tzeis_baal_hatanya === "shabbos_ends",
    "the substitution map is one-directional",
    JSON.stringify(ZMAN_SUBSTITUTE),
  );
  const ordinaryThursday = resolveZmanimForDate({ ...base, date: "2026-09-10", ids: ["shabbos_ends"] });
  check(
    ordinaryThursday.length === 0,
    "asking for shabbos_ends on an ordinary Thursday gives NO row — nightfall never stands in for it",
    ordinaryThursday.map((r) => `${r.label} ${r.display}`).join(","),
  );
}

{
  /*
   * Both nightfall ids selected on a Shabbos — the case where a naive
   * substitution would print one value twice under two labels.
   *
   * With the fallback OFF this isolates the substitution alone: it is
   * SKIPPED, because the substitute is itself selected, so the day yields
   * the one real shabbos_ends row rather than that row plus a copy of it
   * labelled "Shabbat Ends" a second time.
   */
  const off = resolveZmanimForDate({
    ...base,
    fallbackToCalculated: false,
    date: "2026-09-12",
    ids: ["tzeis_baal_hatanya", "shabbos_ends"],
  });
  check(off.length === 1, "both nightfall ids on a Shabbos, fallback off: ONE row, not the same time twice",
    off.map((r) => `${r.label} ${r.display}`).join(" | "));
  check(off[0]?.id === "shabbos_ends" && off[0]?.suppliedBy === null,
    "and it is the real shabbos_ends row — the substituted duplicate is what got dropped",
    `${off[0]?.id} suppliedBy=${off[0]?.suppliedBy}`);

  /*
   * With the fallback ON the same selection gives TWO rows, and that is
   * correct rather than the duplicate above. The substitution is still
   * skipped; nightfall then falls through to the computation, which
   * produces a genuinely different time — 6° nightfall at 8:02 PM against
   * an 8.5° Shabbos end at 8:14 PM. Two real, differently-labelled times,
   * with the computed one flagged. A gabbai who selected both asked for
   * exactly this.
   */
  const on = resolveZmanimForDate({ ...base, date: "2026-09-12", ids: ["tzeis_baal_hatanya", "shabbos_ends"] });
  check(on.length === 2, "both selected, fallback on: two rows", on.map((r) => `${r.label} ${r.display}`).join(" | "));
  check(
    on[0]?.id === "tzeis_baal_hatanya" && on[0]?.fellBackToHebcal === true && on[0]?.suppliedBy === null,
    "the nightfall row is computed and flagged, not substituted",
    `${on[0]?.id} fellBack=${on[0]?.fellBackToHebcal} suppliedBy=${on[0]?.suppliedBy}`,
  );
  check(
    on[1]?.id === "shabbos_ends" && on[1]?.fellBackToHebcal === false && on[1]!.time > on[0]!.time,
    "and Chabad's own Shabbos end sits after it, unflagged",
    `${on[1]?.display} after ${on[0]?.display}`,
  );

  const weekday = resolveZmanimForDate({ ...base, date: "2026-09-10", ids: ["tzeis_baal_hatanya", "shabbos_ends"] });
  check(weekday.length === 1 && weekday[0].id === "tzeis_baal_hatanya",
    "on a weekday the same selection gives the plain nightfall row and nothing else — shabbos_ends is not computed",
    weekday.map((r) => r.id).join(","));
}

console.log("\n-- ITEM 5: chatzos halayla orders last, not first ----------");

const FULL = [
  "alos_baal_hatanya", "misheyakir", "netz", "sof_zman_shma_baal_hatanya",
  "sof_zman_tfila_baal_hatanya", "chatzos", "mincha_gedola", "mincha_ketana",
  "plag_hamincha", "shkia", "tzeis_baal_hatanya", "chatzos_laila",
];

{
  const rows = resolveZmanimForDate({ ...base, date: "2026-09-10", ids: FULL });
  check(rows.length === 12, "all twelve daily rows resolve on an ordinary Thursday", String(rows.length));
  check(
    JSON.stringify(rows.map((r) => r.id)) === JSON.stringify(FULL),
    "ordered by instant, which reproduces Chabad's own column order exactly",
    rows.map((r) => r.id).join(","),
  );
  // The point: 1:27 AM sorts LAST, because its instant is the following
  // morning. A sort on the rendered string, or on a same-day instant,
  // would put it first.
  const last = rows[rows.length - 1];
  check(last.id === "chatzos_laila" && last.display === "1:27 AM",
    "chatzos halayla reads 1:27 AM and still sorts last",
    `${last.id} ${last.display}`);
  check(
    last.time.toISOString() === "2026-09-11T05:27:00.000Z",
    "because its instant is on 9/11 — the night after the row it is filed under",
    last.time.toISOString(),
  );
  check(
    rows.every((row, i) => i === 0 || rows[i - 1].time.getTime() <= row.time.getTime()),
    "and the whole list is monotonic in time",
  );
}

{
  // "Next upcoming" has to respect the same thing. At 11 PM local on 9/10
  // (03:00Z on 9/11) everything on 9/10's list is past EXCEPT chatzos
  // halayla, which has not happened yet.
  const { next } = resolveZmanimTable({ ...base, now: new Date("2026-09-11T03:00:00Z"), ids: FULL });
  check(next?.id === "chatzos_laila",
    "at 11 PM the next zman is chatzos halayla, not tomorrow's alos", `${next?.id} ${next?.display}`);

  // At 2 AM every one of today's rows is behind, so `next` has to reach
  // into tomorrow or show nothing for the last hours of every night.
  const early = resolveZmanimTable({ ...base, now: new Date("2026-09-11T06:00:00Z"), ids: FULL });
  check(early.next?.id === "alos_baal_hatanya",
    "at 2 AM it reaches into the next day and finds alos", `${early.next?.id} ${early.next?.display}`);
  check(early.next !== null && early.next.time > new Date("2026-09-11T06:00:00Z"),
    "and whatever it finds is genuinely in the future");
}

{
  // `all` mode does NOT roll into tomorrow. A luach on a wall shows one
  // date, past rows included.
  const { today } = resolveZmanimTable({ ...base, now: new Date("2026-09-11T06:00:00Z"), ids: FULL });
  check(today.status === "ok" && today.rows[0]?.time.toISOString() === "2026-09-11T10:00:00.000Z",
    "the table stays on today's date at 2 AM — a luach shows the date, not the next 24 hours",
    today.status === "ok" ? today.rows[0]?.time.toISOString() : today.status);
}

console.log("\n-- ITEM 9: the same missing-value mechanism ----------------");

{
  // Fallback OFF on a Chabad board: a date with nothing cached shows no
  // row, and a selection with nothing left is "unavailable" — the same
  // distinct status candle lighting uses, so the widget can say the same
  // calm thing rather than an offline message.
  const off = resolveZmanimTable({
    ...base,
    fallbackToCalculated: false,
    chabadZmanim: {},
    now: new Date("2026-09-10T16:00:00Z"),
    ids: FULL,
  });
  check(off.today.status === "unavailable", "fallback OFF with nothing cached: unavailable", off.today.status);
  check(off.next === null, "and no next row either");

  const on = resolveZmanimTable({
    ...base,
    chabadZmanim: {},
    now: new Date("2026-09-10T16:00:00Z"),
    ids: FULL,
  });
  check(on.today.status === "ok" && on.today.rows.length === 12,
    "fallback ON with nothing cached: all twelve computed",
    on.today.status === "ok" ? String(on.today.rows.length) : on.today.status);
  check(on.today.status === "ok" && on.today.rows.every((r) => r.fellBackToHebcal),
    "and every one is flagged, so the board shows the calculated-times notice");
}

{
  // Hebcal and Manual are the computed path, so the switch has nothing to
  // say about them. Turning it off must not blank a Hebcal widget — the
  // isolation half of item 9.
  for (const provider of ["hebcal", "manual"] as const) {
    const off = resolveZmanimTable({
      ...base,
      provider,
      chabadZmanim: null,
      fallbackToCalculated: false,
      now: new Date("2026-09-10T16:00:00Z"),
      ids: FULL,
    });
    check(off.today.status === "ok" && off.today.rows.length === 12,
      `${provider} with the switch OFF still resolves all twelve — the switch is Chabad-only`,
      off.today.status === "ok" ? String(off.today.rows.length) : off.today.status);
    check(off.today.status === "ok" && off.today.rows.every((r) => !r.fellBackToHebcal),
      `${provider}: and none is flagged`);
  }
}

{
  // A date-conditional row is simply absent rather than "unavailable" —
  // the rest of the table is fine, so the widget must not blank.
  const tuesday = resolveZmanimForDate({ ...base, date: "2026-09-15", ids: ["netz", "candle_lighting", "shkia"] });
  check(tuesday.map((r) => r.id).join(",") === "netz,shkia",
    "candle lighting drops out of a Tuesday's table and the other rows stay",
    tuesday.map((r) => r.id).join(","));
  const friday = resolveZmanimForDate({ ...base, date: "2026-09-11", ids: ["netz", "candle_lighting", "shkia"] });
  check(friday.map((r) => r.id).join(",") === "netz,candle_lighting,shkia",
    "and appears on the Friday, between netz and shkia",
    friday.map((r) => r.id).join(","));
  check(
    friday.find((r) => r.id === "candle_lighting")!.time <
      friday.find((r) => r.id === "shkia")!.time,
    "18 minutes before sunset, so it sorts before it",
  );
}

{
  // An id no source supplies resolves to nothing rather than throwing — a
  // hand-edited document, or a board written by a future build.
  const rows = resolveZmanimForDate({ ...base, date: "2026-09-10", ids: ["sof_zman_shma_gra", "netz"] });
  check(rows.map((r) => r.id).join(",") === "netz",
    "an unsupplied canonical id drops out silently, leaving the rest",
    rows.map((r) => r.id).join(","));
  const unknown = resolveZmanimForDate({ ...base, date: "2026-09-10", ids: ["not_a_zman"] });
  check(unknown.length === 0, "so does an id that is not canonical at all");
}

console.log("\n-- the computed path tracks the cached one it stands in for -");

/*
 * If the fallback used a different shitah the "Showing calculated times"
 * note would be hiding a visibly different number. Measured across every
 * day of the fixture, per id, cached against computed.
 */
{
  const worst: Record<string, number> = {};
  for (const date of DATES) {
    for (const id of FULL) {
      const cachedValue = CACHE[date]?.[id];
      if (!cachedValue || !isClockZman(cachedValue)) continue;
      const computed = computeZman(id, date, LOCATION);
      if (!computed) continue;
      const drift = Math.abs(new Date(cachedValue.iso).getTime() - computed.getTime()) / 60_000;
      worst[id] = Math.max(worst[id] ?? 0, drift);
    }
  }
  for (const [id, drift] of Object.entries(worst)) {
    check(drift <= 1, `${id}: computed is within a minute of Chabad's on all 92 days`, `${drift} min`);
  }
  /*
   * This comparison is what found the DST bug in lib/zmanim/time.ts. Alos
   * and misheyakir came back 60 and 59 minutes off — on one date, 11/1,
   * the fall-back day — because the cached instant was built with an
   * offset read at the guess rather than at the answer. Every other id and
   * every other date agreed to the minute, which is exactly why nothing
   * caught it until a computed value was held against a cached one.
   */
  const fallBackDay = FULL.map((id) => {
    const cachedValue = CACHE["2026-11-01"]?.[id];
    const computed = computeZman(id, "2026-11-01", LOCATION);
    if (!cachedValue || !isClockZman(cachedValue) || !computed) return 0;
    return Math.abs(new Date(cachedValue.iso).getTime() - computed.getTime()) / 60_000;
  });
  check(Math.max(...fallBackDay) <= 1,
    "including on 11/1 itself, the DST fall-back day that exposed the one-pass offset bug",
    `worst ${Math.max(...fallBackDay)} min`);
  check(Object.keys(worst).length === 12, "all twelve were actually compared", String(Object.keys(worst).length));
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
