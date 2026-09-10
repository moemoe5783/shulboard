/*
 * The value shapes `zmanim_cache.times` holds, and the map from
 * Chabad.org's own `EssentialZmanType` vocabulary onto plan.md §5c's
 * canonical zman ids.
 *
 * Client-safe on purpose — no `server-only`, no fetch, no key. Three
 * different places need this and only one of them is a server route:
 * the Get_Zmanim reader (chabad-adapter.ts, server) writes it,
 * resolve.ts (client) reads it, and §5c's capability matrix in a
 * settings panel will need the mapping itself to grey out the rows a
 * provider does not supply. A `server-only` import here would put the
 * third one behind a server round-trip for what is a static table.
 */

/** A clock time: the provider's own rendered string, plus the instant it
 *  refers to. Both, per the `zmanim_cache.times` comment in
 *  supabase/migrations/20260904091100_zmanim_cache.sql — §5c forbids
 *  re-rounding provider output, so `display` is verbatim and `iso` exists
 *  for countdowns and sorting only. */
export type ChabadClockZman = {
  iso: string;
  display: string;
  footnote?: ChabadFootnote;
  label?: string;
};

/**
 * A DURATION, not a time of day — `ShaahZmanit` only ("62:51 min.").
 *
 * Kept rather than excluded, and given its own shape rather than being
 * squeezed into `{iso, display}`. Chabad sends it on every one of the 92
 * days, a shaah zmanis is what every other zman in the response is
 * derived from, and a Zmanim widget row showing "Shaah zmanis — 62:51"
 * is a real thing a luach prints. What it must never be is an instant:
 * `parseZmanTime` would read "62:51" as an hour and a minute, and 62
 * fails its own hour check, so the alternative to modelling it was
 * dropping it silently.
 *
 * `durationSeconds` because the string's own grain is MM:SS — 62 minutes
 * 51 seconds. Seconds, not fractional minutes, so nothing rounds.
 */
export type ChabadDurationZman = {
  durationSeconds: number;
  display: string;
  footnote?: ChabadFootnote;
  label?: string;
};

/**
 * `Zmanim[].FootnoteType`, resolved against the response root's own
 * `Footnotes` dictionary. HALACHICALLY LOAD-BEARING, not decoration —
 * carried into the cache rather than parsed and discarded:
 *
 * - `LightCandlesAfter` on a `ShabbatEndTime` is the second night of a
 *   two-day Yom Tov: candles are lit after nightfall from an existing
 *   flame. It is NOT candle lighting, and the type mapping below keeps it
 *   as `shabbos_ends`; this footnote is the only thing that says why that
 *   row is different from the 14 ordinary `shabbos_ends` rows.
 * - `MenorahLighting` marks the Chanukah days.
 * - `LaterMincha` marks a short day, where some wait a full 30 minutes
 *   after chatzos.
 *
 * `text` is null only if Chabad sends a `FootnoteType` its own root
 * `Footnotes` has no entry for — never seen, and a reason to keep the
 * type rather than drop the whole footnote.
 */
export type ChabadFootnote = { type: string; text: string | null };

/*
 * `label` on both shapes above: THE PROVIDER'S OWN WORDS FOR THIS ZMAN,
 * cached alongside the value so nothing downstream needs a label table.
 *
 * Chabad sends it in the response root's `GroupHeadings[].EssentialTitle`
 * ("Latest Shacharit", "Earliest Tallit", "Shabbat Ends"), and the board
 * shows exactly that. The canonical id is invisible plumbing — it exists so
 * a board document survives a provider change — and translating the
 * provider's wording into house vocabulary on the way to the screen would
 * throw away the one thing that makes the row match the luach on the wall.
 *
 * Optional because a value can predate this field (a row warmed before it
 * existed) or come from a computation rather than a provider. Both fall
 * back to `ZMAN_PANEL_LABEL` below, which is the only place house
 * vocabulary is allowed to reach a board — and only in the absence of the
 * provider's own.
 */

export type ChabadZman = ChabadClockZman | ChabadDurationZman;

/** Narrows the union. A duration has no instant, so nothing that wants a
 *  `Date` may reach for `.iso` without asking. */
export function isClockZman(zman: ChabadZman): zman is ChabadClockZman {
  return "iso" in zman;
}

/**
 * Chabad `EssentialZmanType` -> plan.md §5c canonical zman id.
 *
 * THE RULE FOR WHAT IS IN HERE, because the omissions are the
 * interesting half: a type is mapped when the canonical id names the
 * ZMAN and nothing else, and is left out when every candidate id names a
 * SHITAH that Chabad's value provably is not. Every zman in the response
 * was measured against @hebcal/core's own implementations across all 92
 * days of test/fixtures/chabad-zmanim-33701-92day.json, and the answer is
 * uniform: Chabad.org publishes the Baal HaTanya (Alter Rebbe) shitah.
 * `alosBaalHatanya` and `sofZmanTfilaBaalHatanya` match to the minute on
 * every single day; `sofZmanShmaBaalHatanya`, `minchaGedolaBaalHatanya`,
 * `minchaKetanaBaalHatanya` and `plagHaminchaBaalHatanya` to within one.
 *
 * So `netz`, `shkia`, `chatzos`, `chatzos_laila`, `mincha_gedola`,
 * `mincha_ketana`, `plag_hamincha`, `misheyakir`, `candle_lighting` and
 * `shabbos_ends` are mapped: none of those ids carries a shitah suffix,
 * so a Baal HaTanya value sits under them without asserting anything
 * false.
 *
 * `AlosHashachar`, `LatestShema`, `LatestTefillah` and `Tzeis` were
 * reported gaps until §5c named the four Baal HaTanya ids they needed;
 * they now map to `alos_baal_hatanya`, `sof_zman_shma_baal_hatanya`,
 * `sof_zman_tfila_baal_hatanya` and `tzeis_baal_hatanya`. Those ids name
 * the shitah the measurement established, which is why they are not
 * `sof_zman_shma_gra` and friends: 1–2 minutes from GRA is still a
 * different shitah, and a GRA label would be a false claim about what a
 * board is showing.
 *
 * `ShaahZmanit` is the one type still unmapped — a duration, and §5c's
 * canonical list has no id for one. It stays cached under a
 * provider-namespaced key so the data is not thrown away.
 */
export const CANONICAL_BY_ESSENTIAL_ZMAN_TYPE: Readonly<Record<string, string>> = {
  /** "Earliest Tallit" in Chabad's own column heading, which is what
   *  misheyakir is for. Measured against @hebcal/core's
   *  `misheyakirMachmir` (10.2°): 0–1 minutes on all 92 days. §5c's
   *  `misheyakir` carries no degree, so it holds this without claiming
   *  one. */
  EarliestTefillin: "misheyakir",
  NetzHachamah: "netz",
  Chatzos: "chatzos",
  MinchahGedolah: "mincha_gedola",
  MinchahKetanah: "mincha_ketana",
  PlagHaminchah: "plag_hamincha",
  /** Exactly 18 minutes before `Shkiah` on all 14 candle-lighting days,
   *  which is the `before=18` the request sends and which the response
   *  echoes back in `LocationDetails` ("Candle Lighting is 18 mins.
   *  before sunset"). */
  CandleLighting: "candle_lighting",
  Shkiah: "shkia",
  /**
   * 34–38 minutes after `Shkiah`, matching @hebcal/core's `tzeit(8.5)` to
   * within a minute on all 17 days that carry it — a later, stricter
   * nightfall than the `Tzeis` on the other 75.
   *
   * `Tzeis` and `ShabbatEndTime` are MUTUALLY EXCLUSIVE in the response,
   * measured: the 17 days carrying `ShabbatEndTime` are exactly the 17
   * with no `Tzeis`. Chabad publishes one nightfall per day and relabels
   * it on days a Shabbos or Yom Tov ends, rather than publishing two.
   */
  ShabbatEndTime: "shabbos_ends",
  ChatzosNight: "chatzos_laila",
  /*
   * The four §5c named for this data — plan.md §5c's "What Chabad.org
   * actually supplies, measured." Each matches @hebcal/core's own Baal
   * HaTanya implementation across all 92 days of the fixture: alos and sof
   * zman tfila to the minute, sof zman shma and tzeis to within one.
   */
  AlosHashachar: "alos_baal_hatanya",
  LatestShema: "sof_zman_shma_baal_hatanya",
  LatestTefillah: "sof_zman_tfila_baal_hatanya",
  Tzeis: "tzeis_baal_hatanya",
};

/**
 * The four types with no canonical id in §5c, and the measurement that
 * says why each candidate id is wrong. Exported so
 * scripts/test-chabad-adapter.ts asserts the list rather than a comment
 * describing it, and so the gap is discoverable from code.
 *
 * Every one of these is still cached, under `chabad:<EssentialZmanType>`.
 */
export const UNMAPPED_ESSENTIAL_ZMAN_TYPES: Readonly<Record<string, string>> = {
  ShaahZmanit:
    "A duration, not a clock time, and §5c's canonical list has no id for one at all. " +
    "Cached as ChabadDurationZman rather than dropped, and deliberately NOT selectable in the " +
    "Zmanim widget — see CHABAD_SUPPLIES.",
};

/** `chabad:AlosHashachar` and friends. Namespaced so a canonical id can
 *  never be shadowed by a provider-specific one, and so a later §5c that
 *  does name these can migrate the keys knowing exactly which rows to
 *  touch. */
export function providerNamespacedId(essentialZmanType: string): string {
  return `chabad:${essentialZmanType}`;
}

/**
 * Types whose clock time belongs to the night AFTER their row's date, so
 * the instant is built one civil day later than the row it is filed
 * under. `ChatzosNight` is the only one.
 *
 * PROVEN FROM THE FIXTURE, not inferred from the column order — the
 * column order (Dawn, Sunrise, ..., Sunset, Nightfall, Midnight) suggests
 * it but cannot settle it, because chatzos halayla differs by well under
 * a minute between two adjacent nights. The DST fall-back in the fixture
 * does settle it. On 11/1/2026 clocks go back at 2 AM, so the midpoint of
 * the night that FOLLOWS 11/1 is 12:14 AM EST while the midpoint of the
 * night that PRECEDES it is 1:13 AM EDT — an hour apart, for once. The
 * 11/1 row reads "12:14 AM". It is the following night.
 *
 * Only the INSTANT rolls. The value stays keyed under its own row's date,
 * because chatzos halayla of the night of the 31st belongs in the 31st's
 * zmanim table, which is exactly where Chabad prints it. This is the one
 * place in the cache where a value's `iso` falls on a different calendar
 * day from the row's `date`.
 */
const NIGHT_ROLLOVER_TYPES: ReadonlySet<string> = new Set(["ChatzosNight"]);

/**
 * Whether a parsed time on `essentialZmanType` should be built on the day
 * after its row.
 *
 * The AM test is not belt-and-braces, it is the rule: chatzos halayla is
 * local solar midnight, which lands just after midnight at most US
 * longitudes but can fall just BEFORE it where a location sits near the
 * eastern edge of its timezone. A blanket +1 day would be an hour and a
 * day wrong there; "roll only if the clock reads before noon" is right in
 * both cases and needs no per-location knowledge.
 */
export function rollsIntoNextDay(essentialZmanType: string, hour: number): boolean {
  return NIGHT_ROLLOVER_TYPES.has(essentialZmanType) && hour < 12;
}

/*
 * ---------------------------------------------------------------------------
 * §5c's capability matrix, as data — what the Zmanim widget offers and why.
 * ---------------------------------------------------------------------------
 */

/**
 * Every canonical zman id plan.md §5c names, in the order a luach prints
 * them.
 *
 * THIS IS THE SETTINGS PANEL'S ORDER, NOT THE BOARD'S. A board renders its
 * rows sorted by instant, which is what makes `chatzos_laila` land last
 * (its instant is the following morning — see `rollsIntoNextDay`) without
 * anything special-casing it. This list exists so the checkbox list in the
 * properties panel groups the alternates for one zman together — the three
 * alos shitos next to each other, the four tzeis shitos next to each other
 * — which sorting by any single day's instants would scatter.
 *
 * `chabad:ShaahZmanit` is deliberately absent. It is cached, it is real,
 * and it is not offered — see CHABAD_SUPPLIES.
 */
export const CANONICAL_ZMAN_ORDER: readonly string[] = [
  "alos_72",
  "alos_16.1deg",
  "alos_baal_hatanya",
  "misheyakir",
  "netz",
  "sof_zman_shma_mga",
  "sof_zman_shma_gra",
  "sof_zman_shma_baal_hatanya",
  "sof_zman_tfila_mga",
  "sof_zman_tfila_gra",
  "sof_zman_tfila_baal_hatanya",
  "chatzos",
  "mincha_gedola",
  "mincha_ketana",
  "plag_hamincha",
  "candle_lighting",
  "shkia",
  "tzeis_baal_hatanya",
  "tzeis_medium_stars",
  "tzeis_3_stars",
  "tzeis_72",
  "shabbos_ends",
  "chatzos_laila",
];

/**
 * House vocabulary for each canonical id — **editor chrome, and a last
 * resort on a board.**
 *
 * THE BOARD PREFERS THE PROVIDER'S OWN WORDS. A cached value carries its
 * provider's label (`ChabadClockZman.label`) and the renderer shows that
 * verbatim: Chabad says "Latest Shacharit", the board says "Latest
 * Shacharit". This table is used in exactly two places, both of which have
 * no provider string to show instead:
 *
 * 1. **The properties panel's checkbox list.** The panel is chrome
 *    (design.md §1b), it uses the product's own words like every other
 *    control, and it cannot reach the cache anyway — `BoardZmanimProvider`
 *    wraps the renderer, not the panel, and a Settings component receives
 *    `{config, onChange}` and nothing else.
 * 2. **A computed row on a board with no warmed cache** — a Hebcal-provider
 *    board, or a Chabad one whose cron has never run. Note that a Chabad
 *    board WITH a warmed cache shows the provider's label even on a
 *    computed row, because a label does not vary by date and the resolver
 *    harvests it from any date the cache has (see resolve-zmanim.ts).
 *
 * Sentence case, and the community's words rather than translations of them
 * — CLAUDE.md's copy rule. A gabbai reads "Sof zman shma", not "Latest time
 * for the morning Shema".
 */
export const ZMAN_PANEL_LABEL: Readonly<Record<string, string>> = {
  alos_72: "Alos (72 minutes)",
  "alos_16.1deg": "Alos (16.1°)",
  alos_baal_hatanya: "Alos (Baal HaTanya)",
  misheyakir: "Misheyakir",
  netz: "Netz",
  sof_zman_shma_mga: "Sof zman shma (MGA)",
  sof_zman_shma_gra: "Sof zman shma (GRA)",
  sof_zman_shma_baal_hatanya: "Sof zman shma (Baal HaTanya)",
  sof_zman_tfila_mga: "Sof zman tfila (MGA)",
  sof_zman_tfila_gra: "Sof zman tfila (GRA)",
  sof_zman_tfila_baal_hatanya: "Sof zman tfila (Baal HaTanya)",
  chatzos: "Chatzos",
  mincha_gedola: "Mincha gedola",
  mincha_ketana: "Mincha ketana",
  plag_hamincha: "Plag hamincha",
  candle_lighting: "Candle lighting",
  shkia: "Shkia",
  tzeis_baal_hatanya: "Tzeis (Baal HaTanya)",
  tzeis_medium_stars: "Tzeis (3 medium stars)",
  tzeis_3_stars: "Tzeis (3 stars)",
  tzeis_72: "Tzeis (72 minutes)",
  shabbos_ends: "Shabbos ends",
  chatzos_laila: "Chatzos halayla",
};

/**
 * The canonical ids Chabad.org actually supplies — §5c's capability matrix
 * for the one provider that has a cache.
 *
 * §5c: "The settings UI greys out unavailable ones — never render a blank
 * row on a screen someone is standing in front of." Everything in
 * `CANONICAL_ZMAN_ORDER` that is not in here is shown disabled in the
 * panel with a reason, not hidden — hiding them makes a gabbai think the
 * app is broken, and the reason is the interesting part: the GRA and MGA
 * shitos are absent because Chabad publishes Baal HaTanya, not because
 * nobody got round to them.
 *
 * `chabad:ShaahZmanit` IS supplied and is still not here, which is a
 * decision rather than an omission. Three reasons, any one of which would
 * be enough:
 *
 * - **It has no canonical id.** Putting `chabad:ShaahZmanit` in a board
 *   document would defeat the single property these config keys exist for:
 *   a canonical id is invisible plumbing so a board survives a provider
 *   change, and a provider-namespaced key is a board that breaks the day
 *   the provider changes.
 * - **It cannot sort into a time-ordered list.** A board's rows are ordered
 *   by instant and a duration has none, so it would need its own region
 *   below the table — a second layout concept for one row.
 * - **It is a derivation, not a zman.** A printed luach carries it because
 *   the reader may want to compute something; nobody in a lobby davens by
 *   it.
 *
 * Naming an id for it later and adding a row is purely additive — the value
 * is already cached on all 92 days.
 */
export const CHABAD_SUPPLIES: ReadonlySet<string> = new Set(
  Object.values(CANONICAL_BY_ESSENTIAL_ZMAN_TYPE),
);

/**
 * One canonical id whose value may legitimately be served by a different
 * one, and the id that serves it.
 *
 * `tzeis_baal_hatanya` <- `shabbos_ends`, AND ONLY IN THAT DIRECTION.
 *
 * WHY THIS EXISTS AT ALL: Chabad publishes exactly one nightfall per day
 * and relabels it. Measured over the 92-day fixture, the 17 days carrying
 * `ShabbatEndTime` are exactly the 17 with no `Tzeis` — so a board
 * configured to show nightfall goes blank every single Shabbos and Yom Tov
 * without this, which is precisely when the most people are standing in
 * front of it.
 *
 * WHY NOT THE OTHER DIRECTION: a plain 6° nightfall is 24–26 minutes after
 * sunset and a Shabbos-end time is 34–38 (8.5°). Showing the earlier one
 * under a "Shabbos ends" row would tell a room that Shabbos is over ten
 * minutes before it is. Substituting toward the stricter time is safe;
 * substituting away from it is not, which is why this is a one-way map and
 * not a pair of equivalent ids.
 *
 * The substituted row carries the SUBSTITUTE's own label — Chabad's
 * "Shabbat Ends" — so the board never claims the value is something it
 * isn't. That is the whole disclosure, and it is why this needs no badge.
 */
export const ZMAN_SUBSTITUTE: Readonly<Record<string, string>> = {
  tzeis_baal_hatanya: "shabbos_ends",
};
