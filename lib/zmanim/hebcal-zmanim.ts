import { GeoLocation, Zmanim } from "@hebcal/core";
import type { BoardLocation } from "@/lib/board-location";

/*
 * Zmanim computed client-side from lat/long — the Hebcal leg of §5c's
 * fallback chain.
 *
 * NOT WIRED TO ANYTHING, AND DELIBERATELY KEPT. Nothing imports
 * `computeZman` or `HEBCAL_COMPUTABLE` outside this module's own test.
 *
 * WHY IT IS UNWIRED: Chabad.org is the only zmanim source
 * (lib/zmanim/provider.ts), and the calculated-times path is gone in both
 * widgets — a date Chabad has not published now shows the unavailable
 * state rather than a computed stand-in with a "showing calculated times"
 * note. There is no caller left for a computed zman.
 *
 * WHY IT IS NOT DELETED: it is measurably correct against real provider
 * data — every value here sits within one minute of Chabad's on all 92
 * days of test/fixtures/chabad-zmanim-33701-92day.json, per shitah,
 * including across the DST fall-back — and re-offering Hebcal as a
 * provider is a decision about what a board may show, not a piece of work.
 * Wiring it back is an import in resolve-zmanim.ts plus a branch;
 * rewriting it would be the measurement all over again.
 *
 * This is NOT a removal of @hebcal/core, which is untouched and still
 * powers the Hebrew Date, Parsha and Daf Yomi widgets, and still tells
 * candle lighting which dates are candle-lighting dates.
 *
 * Client-safe, pure, no fetch, no key — @hebcal/core computes all of this
 * from lat/long and a date, which is plan.md §3b's whole "compute locally"
 * decision. This is the same role `lib/hebrew/candle-times.ts` plays for
 * candle lighting; that module is not extended because it is about candle
 * lighting and Havdalah as *events* (which upcoming Friday, which Yom Tov)
 * and this is about one calendar day's table of times.
 *
 * ONE SHITAH THROUGHOUT: BAAL HATANYA, and that is a stated choice rather
 * than a blend.
 *
 * Four of the canonical ids this computes name that shitah outright —
 * `alos_baal_hatanya`, `sof_zman_shma_baal_hatanya`,
 * `sof_zman_tfila_baal_hatanya`, `tzeis_baal_hatanya` (plan.md §5c) — so a
 * gabbai who selects those rows has selected the shitah by selecting the
 * row. The shitah-neutral ids (`netz`, `shkia`, `chatzos`,
 * `mincha_gedola`, `mincha_ketana`, `plag_hamincha`, `misheyakir`,
 * `chatzos_laila`) then use @hebcal/core's Baal HaTanya variant WHERE ONE
 * EXISTS, for internal consistency: a table mixing Baal HaTanya's alos
 * with the GRA's plag is a table no luach prints. The difference is not
 * cosmetic — plag is 3–4 minutes apart between the two, and misheyakir 6–8
 * (10.2° vs @hebcal/core's own 11° default).
 *
 * This also means the discrepancy against a Chabad value it stands in for
 * is at most a minute on every row, measured across all 92 days of
 * test/fixtures/chabad-zmanim-33701-92day.json. That is what makes the
 * "Showing calculated times" indicator an honest small-print note rather
 * than a warning about a visibly different number.
 *
 * WHAT IS DELIBERATELY NOT HERE: `candle_lighting` and `shabbos_ends`.
 * Both are date-conditional events, not times every day has, and working
 * out which dates they fall on is exactly what
 * `lib/hebrew/candle-times.ts` and the Candle Lighting widget already do.
 * Computing them a second time here would be the second mechanism
 * CLAUDE.md and the Candle Lighting work both refuse. The consequence,
 * stated rather than hidden: on a board whose zmanim cache has nothing for
 * a date, those two rows are absent rather than computed.
 */

/** Canonical ids this can compute. Anything else resolves to nothing —
 *  see the note above on candle lighting. */
export const HEBCAL_COMPUTABLE: ReadonlySet<string> = new Set([
  "alos_baal_hatanya",
  "misheyakir",
  "netz",
  "sof_zman_shma_baal_hatanya",
  "sof_zman_tfila_baal_hatanya",
  "chatzos",
  "mincha_gedola",
  "mincha_ketana",
  "plag_hamincha",
  "shkia",
  "tzeis_baal_hatanya",
  "chatzos_laila",
]);

/** @hebcal/core returns some zmanim as a Temporal.ZonedDateTime and some as
 *  a Date, depending on the method. One narrow adapter rather than a
 *  per-call `instanceof`. */
function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof (value as { epochMilliseconds?: unknown }).epochMilliseconds === "number") {
    return new Date((value as { epochMilliseconds: number }).epochMilliseconds);
  }
  return null;
}

/**
 * Truncated to the minute, because that is the grain every provider
 * publishes and the grain a board renders.
 *
 * §5c's "never re-round or recompute provider output" is not in play here —
 * this IS the computation, not a provider's value being second-guessed.
 * What matters is that the instant used for ordering and for "which is
 * next" agrees with the string on screen: @hebcal/core returns seconds
 * (`14:20:28`), `Intl.DateTimeFormat` with hour+minute drops them, and a
 * row whose instant says 14:20:28 while its label says 2:20 goes "next" 28
 * seconds later than the board appears to.
 *
 * Floor, not round, for the same reason candle lighting is published early
 * rather than late: for the zmanim that are deadlines (sof zman shma, sof
 * zman tfila) the earlier minute is the safe direction, and applying one
 * rule to every row keeps the table internally ordered.
 */
function toMinute(value: Date | null): Date | null {
  if (!value) return null;
  return new Date(Math.floor(value.getTime() / 60_000) * 60_000);
}

/**
 * One canonical id's instant on one calendar date, computed.
 *
 * `date` is a plain civil date in the shul's own zone (`YYYY-MM-DD`) —
 * @hebcal/core's `Zmanim` takes a local calendar day plus a `GeoLocation`
 * carrying the IANA zone, so nothing here does timezone arithmetic itself.
 *
 * Returns `null` for an id this cannot compute, which is not an error —
 * `candle_lighting` on a Tuesday and `shabbos_ends` on any day both land
 * here, and the caller drops the row.
 */
export function computeZman(id: string, date: string, location: BoardLocation): Date | null {
  if (!HEBCAL_COMPUTABLE.has(id)) return null;

  const [year, month, day] = date.split("-").map(Number);
  const geo = new GeoLocation(null, location.latitude, location.longitude, 0, location.timeZone);
  const zmanim = new Zmanim(geo, new Date(year, month - 1, day), false);

  switch (id) {
    case "alos_baal_hatanya":
      return toMinute(asDate(zmanim.alosBaalHatanya()));
    /* 10.2°, @hebcal/core's `misheyakirMachmir`, not its 11° `misheyakir`
       default — see this file's note on one shitah throughout. The two are
       6–8 minutes apart, and 10.2° is the one Chabad's own "Earliest
       Tallit" matches to the minute. */
    case "misheyakir":
      return toMinute(asDate(zmanim.misheyakirMachmir()));
    case "netz":
      return toMinute(asDate(zmanim.sunrise()));
    case "sof_zman_shma_baal_hatanya":
      return toMinute(asDate(zmanim.sofZmanShmaBaalHatanya()));
    case "sof_zman_tfila_baal_hatanya":
      return toMinute(asDate(zmanim.sofZmanTfilaBaalHatanya()));
    case "chatzos":
      return toMinute(asDate(zmanim.chatzot()));
    case "mincha_gedola":
      return toMinute(asDate(zmanim.minchaGedolaBaalHatanya()));
    case "mincha_ketana":
      return toMinute(asDate(zmanim.minchaKetanaBaalHatanya()));
    case "plag_hamincha":
      return toMinute(asDate(zmanim.plagHaminchaBaalHatanya()));
    case "shkia":
      return toMinute(asDate(zmanim.sunset()));
    case "tzeis_baal_hatanya":
      return toMinute(asDate(zmanim.tzaisBaalHatanya()));
    /*
     * THE ONE ID WHOSE ANCHOR DAY DIFFERS, and it is a real off-by-a-day
     * trap rather than a nicety.
     *
     * @hebcal/core's `chatzotNight()` for a date returns the midpoint of
     * the night that ENDS that morning — the night before. Chabad files
     * chatzos halayla on the row of the day whose night FOLLOWS it, proven
     * off the Nov 1 DST fall-back (zman.ts's `rollsIntoNextDay`), and this
     * project's cache follows Chabad. So a computed value has to ask for
     * the next day to land on the same night as the cached one it is
     * standing in for; asking for the same day would put it 24 hours
     * early, on a row already past.
     */
    case "chatzos_laila": {
      const next = new Date(Date.UTC(year, month - 1, day + 1));
      const following = new Zmanim(
        geo,
        new Date(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate()),
        false,
      );
      return toMinute(asDate(following.chatzotNight()));
    }
    default:
      return null;
  }
}
