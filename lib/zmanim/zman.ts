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
 * `AlosHashachar`, `LatestShema`, `LatestTefillah` and `Tzeis` are NOT
 * mapped, and that is a reported gap rather than a nearest-fit guess —
 * §5c offers `alos_72`/`alos_16.1deg`, `sof_zman_shma_gra`/`_mga`,
 * `sof_zman_tfila_gra`/`_mga` and `tzeis_3_stars`/`tzeis_medium_stars`/
 * `tzeis_72`, and each of those names a shitah this value is measurably
 * not (see `UNMAPPED_ESSENTIAL_ZMAN_TYPES`). They are cached under a
 * provider-namespaced key instead, so the data is not thrown away while
 * §5c's vocabulary is short four ids.
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
  AlosHashachar:
    "Baal HaTanya alos — matches @hebcal/core's alosBaalHatanya to the minute on all 92 days. " +
    "Not alos_72 (measured 73–79 min before netz, so it varies with the season and is not a fixed offset) " +
    "and not alos_16.1deg (3–4 min earlier than it). §5c needs a third id, e.g. alos_baal_hatanya.",
  LatestShema:
    "Baal HaTanya sof zman shma — 0 to 1 min from sofZmanShmaBaalHatanya, 1–2 min from GRA, 34–35 min later than MGA. " +
    "Close enough to GRA to be tempting and still a different shitah, so sof_zman_shma_gra would be a false label.",
  LatestTefillah:
    "Baal HaTanya sof zman tfila — exactly 0 min from sofZmanTfilaBaalHatanya on all 92 days, 1–2 min from GRA. " +
    "Same reasoning as LatestShema.",
  Tzeis:
    "Baal HaTanya tzeis (6°) — exactly 1 min after tzaisBaalHatanya on all 75 days that carry it. " +
    "Earlier than all three of §5c's tzeis ids: tzeis_medium_stars (7.0833°) is 3–5 min later, " +
    "tzeis_3_stars (8.5°) is what ShabbatEndTime matches instead, and tzeis_72 is 34–37 min later.",
  ShaahZmanit:
    "A duration, not a clock time, and §5c's canonical list has no id for one at all. " +
    "Cached as ChabadDurationZman rather than dropped.",
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
