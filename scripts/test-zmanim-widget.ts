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
import { resolveZmanimForDate, resolveZmanimTable } from "../lib/zmanim/resolve-zmanim.ts";
import { splitTimeColumns } from "../widgets/zmanim/display-time.ts";
import type { ChabadZmanimByDate } from "../lib/zmanim/resolve.ts";
import {
  CANONICAL_ZMAN_ORDER,
  CHABAD_SUPPLIES,
  ZMAN_PANEL_LABEL,
  ZMAN_SUBSTITUTE,
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
  location: LOCATION,
  chabadZmanim: CACHE as ChabadZmanimByDate,
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
  [...CHABAD_SUPPLIES].every((id) => ZMAN_PANEL_LABEL[id] !== undefined),
  "and each has a panel label, so no selectable checkbox can render its raw id",
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
  check(rows.every((row) => row.suppliedBy === null), "and neither row is marked as substituted");
}

{
  // With nothing cached for a date there is no row at all — no computed
  // stand-in exists any more. The rest of the cache is irrelevant to that.
  const thinned: ChabadZmanimByDate = { ...CACHE, "2026-09-10": {} };
  const rows = resolveZmanimForDate({ ...base, chabadZmanim: thinned, date: "2026-09-10", ids: ["netz"] });
  check(rows.length === 0, "a date Chabad has no value for yields no row, not a calculated one",
    rows.map((r) => `${r.label} ${r.display}`).join(","));
}

{
  /*
   * Labels are harvested from EVERY cached date rather than the one being
   * rendered, and with the computed path gone this is the only remaining
   * reason that matters: a substituted row needs the SUBSTITUTE's label,
   * and on a Shabbos the requested id has no row of its own to read one
   * from.
   */
  const onlyShabbos: ChabadZmanimByDate = { "2026-09-12": CACHE["2026-09-12"] };
  const rows = resolveZmanimForDate({
    ...base,
    chabadZmanim: onlyShabbos,
    date: "2026-09-12",
    ids: ["tzeis_baal_hatanya"],
  });
  check(rows[0]?.label === "Shabbat Ends",
    "a substituted row is labelled from the id that supplied it, not the id that was asked for",
    rows[0]?.label);
}

{
  // House vocabulary is only reachable when the cache holds nothing for
  // the id at all — which is a board showing no rows anyway. Asserted so
  // "Netz" never quietly appears on a screen beside Chabad's own wording.
  const rows = resolveZmanimForDate({ ...base, chabadZmanim: null, date: "2026-09-10", ids: ["netz"] });
  check(rows.length === 0, "no cache at all: no rows, so no house label can reach a board");
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
  check(rows[0]?.suppliedBy === "shabbos_ends",
    "and the row records which id supplied it, so a substitution is distinguishable from a direct hit",
    String(rows[0]?.suppliedBy));
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
   * The substitution is SKIPPED because the substitute is itself selected,
   * so the day yields the one real shabbos_ends row rather than that row
   * plus a copy of it labelled "Shabbat Ends" a second time. There is no
   * fallback left for the requested id to reach instead, so this is now the
   * only outcome rather than one of two.
   */
  const shabbos = resolveZmanimForDate({
    ...base,
    date: "2026-09-12",
    ids: ["tzeis_baal_hatanya", "shabbos_ends"],
  });
  check(shabbos.length === 1, "both nightfall ids on a Shabbos: ONE row, not the same time twice",
    shabbos.map((r) => `${r.label} ${r.display}`).join(" | "));
  check(shabbos[0]?.id === "shabbos_ends" && shabbos[0]?.suppliedBy === null,
    "and it is the real shabbos_ends row — the substituted duplicate is what got dropped",
    `${shabbos[0]?.id} suppliedBy=${shabbos[0]?.suppliedBy}`);

  const weekday = resolveZmanimForDate({ ...base, date: "2026-09-10", ids: ["tzeis_baal_hatanya", "shabbos_ends"] });
  check(weekday.length === 1 && weekday[0].id === "tzeis_baal_hatanya",
    "on a weekday the same selection gives the plain nightfall row and nothing else",
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

console.log("\n-- a missing value is missing, full stop -------------------");

{
  // No switch to test any more. A date Chabad has nothing for yields no
  // rows, and a selection with nothing left is `unavailable` — the same
  // distinct status candle lighting uses, so the widget says the same calm
  // thing rather than an offline message.
  const empty = resolveZmanimTable({
    ...base,
    chabadZmanim: {},
    now: new Date("2026-09-10T16:00:00Z"),
    ids: FULL,
  });
  check(empty.today.status === "unavailable", "nothing cached: unavailable, never calculated", empty.today.status);
  check(empty.next === null, "and no next row either");

  const nullCache = resolveZmanimTable({
    ...base,
    chabadZmanim: null,
    now: new Date("2026-09-10T16:00:00Z"),
    ids: FULL,
  });
  check(nullCache.today.status === "unavailable", "no cache at all: the same answer", nullCache.today.status);
}

{
  // Past the 92-day window — the state this is now the common cause of.
  const past = resolveZmanimTable({ ...base, now: new Date("2026-12-20T16:00:00Z"), ids: FULL });
  check(past.today.status === "unavailable",
    "a date past the warmed window is unavailable — the ordinary outcome now, not a corner",
    past.today.status);
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
    friday.find((r) => r.id === "candle_lighting")!.time < friday.find((r) => r.id === "shkia")!.time,
    "18 minutes before sunset, so it sorts before it",
  );
}

{
  // THE ROW COUNT VARYING IS WHY `fit` PADS TO THE DECLARED SELECTION.
  // Measured here rather than asserted in a comment: the same selection
  // yields three rows on a Friday and two on the Tuesday before, and the
  // declared count is the upper bound of both — which is what the
  // Renderer's spacer rows hold the fit measurement steady against.
  const declared = ["netz", "candle_lighting", "shkia"];
  const friday = resolveZmanimForDate({ ...base, date: "2026-09-11", ids: declared });
  const tuesday = resolveZmanimForDate({ ...base, date: "2026-09-15", ids: declared });
  check(friday.length !== tuesday.length,
    "a fixed selection resolves to a different number of rows on different days",
    `${friday.length} on Friday vs ${tuesday.length} on Tuesday`);
  check(
    friday.length <= declared.length && tuesday.length <= declared.length,
    "and neither day exceeds the declared count — a date-conditional row can only be absent, never extra",
    `declared ${declared.length}`,
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

console.log("\n-- the Hebrew label, and where it must not come from -------");

{
  // The flat 92-day cache has no Hebrew, so every row resolves with none.
  // The widget falls back to the provider's English there rather than to a
  // house Hebrew table — see the note in lib/zmanim/zman.ts on why there
  // deliberately is not one.
  const rows = resolveZmanimForDate({ ...base, date: "2026-09-10", ids: ["netz", "chatzos"] });
  check(rows.every((row) => row.hebrewLabel === null),
    "a flat-shape cache resolves every row with no Hebrew, never an invented one",
    rows.map((r) => `${r.id}:${r.hebrewLabel}`).join(" "));
  check(rows.every((row) => row.label.length > 0), "while the English is always there to fall back to");
}

{
  /*
   * A cache that DOES carry Hebrew — what the nested response shape
   * produces. Hand-built here rather than loaded, because the nested
   * fixture is a different ZIP and four days; what matters is that the
   * resolver passes the field through from the row it read, including
   * through a substitution.
   */
  const withHebrew: ChabadZmanimByDate = {
    "2026-09-12": {
      shabbos_ends: {
        iso: "2026-09-13T00:14:00.000Z",
        display: "8:14 PM",
        label: "Shabbat Ends",
        hebrewLabel: "הדלקת נרות",
      },
    },
  };
  const direct = resolveZmanimForDate({ ...base, chabadZmanim: withHebrew, date: "2026-09-12", ids: ["shabbos_ends"] });
  check(direct[0]?.hebrewLabel === "הדלקת נרות", "a row's Hebrew comes through", direct[0]?.hebrewLabel);

  // THE SUBSTITUTION CARRIES THE SUBSTITUTE'S HEBREW, not the requested
  // id's. That is the same rule the English label follows, and it is what
  // puts the Yom Tov distinction on the right day: Chabad's Hebrew for a
  // second-night Shabbos-end row says candle lighting, and the row a
  // nightfall request is served by has to say what it actually is.
  const substituted = resolveZmanimForDate({
    ...base,
    chabadZmanim: withHebrew,
    date: "2026-09-12",
    ids: ["tzeis_baal_hatanya"],
  });
  check(substituted[0]?.suppliedBy === "shabbos_ends" && substituted[0]?.hebrewLabel === "הדלקת נרות",
    "and a substituted row carries the Hebrew of the id that supplied it",
    `${substituted[0]?.hebrewLabel} via ${substituted[0]?.suppliedBy}`);
  check(substituted[0]?.label === "Shabbat Ends", "alongside that id's English");
}

console.log("\n-- ITEM 3: the time splits into columns, verbatim ----------");

/*
 * ALIGNMENT BY THE TIME'S INTERNAL STRUCTURE, reported from a live board:
 * "7:22 PM" and "11:21 AM" differ in digit count, so right-aligning the
 * whole string leaves the two-digit hour hanging out past every
 * single-digit one. The Renderer gives the hour, the ":MM" and the meridiem
 * a grid track each, shared across rows, and right-aligns inside the hour's
 * — which is what puts the colon at one x and makes the outer edge straight.
 *
 * THE SPLIT MUST NOT BECOME A REFORMAT. plan.md §5c: "never re-round or
 * recompute provider output. Display verbatim." So the load-bearing
 * assertion here is that the pieces rejoin to the exact string Chabad sent,
 * across every clock value in the 92-day fixture — separator spacing
 * included.
 */
{
  const everyValue: string[] = [];
  for (const date of DATES) {
    for (const value of Object.values(CACHE[date] ?? {})) {
      if ("display" in value && typeof value.display === "string") everyValue.push(value.display);
    }
  }
  check(everyValue.length > 1000, "the fixture supplies a real sample of values", `${everyValue.length} values`);

  const rejoined = everyValue.filter((display) => {
    const parts = splitTimeColumns(display);
    return parts === null || parts.hours + parts.minutes + parts.meridiem === display;
  });
  check(
    rejoined.length === everyValue.length,
    "every value in the fixture rejoins to itself exactly — the split never rewrites a time",
    `${rejoined.length}/${everyValue.length}`,
  );

  const unrecognised = everyValue.filter((display) => splitTimeColumns(display) === null);
  // ShaahZmanit is a duration ("62:51 min."), and it is the one shape in
  // the response that is not a clock time. It still matches — hours,
  // minutes, and " min." as the tail — which is fine: it is not offered in
  // this widget, and a shape that matches is a shape that aligns.
  check(
    unrecognised.length === 0,
    "and nothing in a real response fails to split, so nothing falls back to the unaligned path",
    unrecognised.slice(0, 3).join(", ") || "none",
  );
}

{
  // The two strings from the report, which is the case the tracks exist
  // for: same shape, different hour width, and the hour is what has to
  // right-align.
  const short = splitTimeColumns("7:22 PM");
  const long = splitTimeColumns("11:21 AM");
  check(short?.hours === "7" && long?.hours === "11", "the hour is its own piece, unpadded",
    `${short?.hours} / ${long?.hours}`);
  check(short?.minutes === ":22" && long?.minutes === ":21",
    "the colon travels with the minutes, so its position is the track's and not the hour's",
    `${short?.minutes} / ${long?.minutes}`);
  check(short?.meridiem === " PM" && long?.meridiem === " AM",
    "and the meridiem keeps the provider's own leading space rather than padding we invented",
    `"${short?.meridiem}" / "${long?.meridiem}"`);
}

{
  // A 24-hour string, and one with seconds — neither is what Chabad sends
  // today, and both have to land somewhere sane if it ever does.
  const twentyFour = splitTimeColumns("19:22");
  check(twentyFour?.hours === "19" && twentyFour?.minutes === ":22" && twentyFour?.meridiem === "",
    "a 24-hour string leaves the meridiem column empty, so the track collapses",
    JSON.stringify(twentyFour));
  const seconds = splitTimeColumns("7:22:30 PM");
  check(seconds?.minutes === ":22:30", "seconds stay with the minutes rather than splitting the column",
    JSON.stringify(seconds));
  check(splitTimeColumns("") === null && splitTimeColumns("no time") === null,
    "and a string with no clock in it returns null, so the Renderer prints it whole and unaligned");
}

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
