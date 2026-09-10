import type { BoardLocation } from "@/lib/board-location";
// Extensioned relative imports, the way lib/zmanim/resolve.ts does it, so a
// plain `node` test script resolves them with no bundler to read tsconfig's
// `@/` alias.
import { computeZman } from "./hebcal-zmanim.ts";
import { ZMAN_PANEL_LABEL, ZMAN_SUBSTITUTE, isClockZman, type ChabadZman } from "./zman.ts";
import type { ChabadZmanimByDate } from "./resolve.ts";

/*
 * A day's zmanim table, resolved — plan.md §5c's fallback chain
 * ("requested provider -> cache -> Hebcal -> last known good") for the
 * thirteen daily zmanim rather than for candle lighting.
 *
 * A SIBLING OF resolve.ts, NOT AN EXTENSION OF IT. That module answers
 * "which candle lighting is next and where did it come from", which is a
 * question about events on a calendar; this one answers "what does today's
 * luach say", which is a question about one date's table. They share the
 * cache shape, the fallback switch and the `fellBackToHebcal` flag — the
 * mechanism item 9 of this task says not to build twice — and nothing
 * else.
 *
 * Client-safe, pure, no fetch: same reason resolve.ts is. Everything about
 * which source won, whether a row was substituted, and whether the shul
 * allows a computed stand-in is decided here so a test can drive it
 * directly instead of through a rendered component.
 */

export type ResolvedZman = {
  /** The canonical id the gabbai selected — not the id that supplied the
   *  value, when those differ. Config order and dedupe both key on this. */
  id: string;
  /**
   * What the board prints. THE PROVIDER'S OWN WORDS whenever there are
   * any: Chabad says "Latest Shacharit", the board says "Latest
   * Shacharit". Falls back to `ZMAN_PANEL_LABEL`'s house vocabulary only
   * when no cached row anywhere carries a label for this id — see
   * `harvestLabels`.
   */
  label: string;
  /** The instant. Used for ordering and for "which is next", never
   *  rendered directly — `display` is. */
  time: Date;
  /** The provider's own rendered string, verbatim (§5c: never re-round
   *  provider output), or this project's own formatting of a computed
   *  value. The renderer prints this and does not reformat it. */
  display: string;
  /** True only when the resolved provider was Chabad and its cache had
   *  nothing for this id on this date, so the value is @hebcal/core's own
   *  computation standing in. Always false for hebcal and manual, which
   *  ARE the computed path — flagging them would make the indicator
   *  meaningless. Same rule as resolve.ts. */
  fellBackToHebcal: boolean;
  /** The provider's halachic footnote for this row, when it sent one —
   *  "Light Candles after this time", the LaterMincha note on a short day,
   *  the Chanukah menorah note. Null when there is none. */
  footnote: string | null;
  /**
   * The canonical id that actually supplied the value, when it is not
   * `id`. Only ever `"shabbos_ends"` today, standing in for
   * `"tzeis_baal_hatanya"` on the days Chabad publishes one nightfall
   * under the other name — see `ZMAN_SUBSTITUTE`.
   *
   * Nothing renders this. It exists so a test can assert the substitution
   * happened on exactly the right days rather than inferring it from a
   * time, and so a future divergence warning (§5c rule 1) has something to
   * read.
   */
  suppliedBy: string | null;
};

export type ZmanimResolution =
  | { status: "ok"; rows: ResolvedZman[] }
  /**
   * Nothing to show: every selected zman is missing for this date and the
   * widget has been told not to compute substitutes
   * (`fallbackToCalculated: false`), or none of them is computable.
   *
   * A DISTINCT STATUS, not an empty list, and NOT AN OFFLINE CONDITION —
   * the same wording rule candle lighting already follows. The display
   * route boots from its last-known-good bundle (plan.md §3c) and keeps
   * rendering with no network, so a screen showing this is almost
   * certainly online and simply has no values for that date.
   */
  | { status: "unavailable" };

/** A date's calendar day in `timeZone` as `YYYY-MM-DD` — the key both
 *  `ChabadZmanimByDate` and `zmanim_cache.date` use. Same `formatToParts`
 *  construction as resolve.ts's own, for the same reason: en-CA happens to
 *  render ISO-ish today, but the part types are the contract. */
export function isoDateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Canonical id -> the provider's own label, harvested from EVERY cached
 * date rather than from the one being rendered.
 *
 * This is what lets a computed row still show the provider's wording. A
 * label does not vary by date — Chabad sends one `GroupHeadings` block for
 * the whole 92-day response and the adapter copies it onto each value — so
 * any date that has the id has the right string for it. Today's row can be
 * missing `tzeis_baal_hatanya` (it is a Shabbos) while seventy-five other
 * cached days carry both its value and its label.
 *
 * Without this, "Calculate missing times" would silently switch a row from
 * the provider's words to ours, which is a visible change on the board for
 * a reason that has nothing to do with wording.
 */
function harvestLabels(cache: ChabadZmanimByDate | null): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!cache) return labels;
  for (const day of Object.values(cache)) {
    for (const [id, zman] of Object.entries(day)) {
      if (labels[id]) continue;
      if (zman.label) labels[id] = zman.label;
    }
  }
  return labels;
}

/** A cached clock value for one id on one date, or undefined. Narrows the
 *  union: `chabad:ShaahZmanit` is a duration and must never be read as an
 *  instant. */
function cachedClock(cache: ChabadZmanimByDate | null, date: string, id: string) {
  const value: ChabadZman | undefined = cache?.[date]?.[id];
  return value && isClockZman(value) ? value : undefined;
}

/** How this project renders a computed time. Deliberately the same
 *  `Intl` call `lib/hebrew/format.ts`'s `formatTimeOfDay` makes, so a
 *  computed row and a Clock widget on the same board agree. */
function formatComputed(instant: Date, opts: { hour12: boolean; timeZone: string }): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: opts.hour12,
    timeZone: opts.timeZone,
  }).format(instant);
}

/**
 * One calendar date's selected zmanim, in the order a board shows them.
 *
 * ORDERED BY INSTANT, not by the config's order and not by
 * `CANONICAL_ZMAN_ORDER`. Two reasons, and the second is the load-bearing
 * one: a luach is chronological, and `chatzos_laila`'s instant falls on the
 * FOLLOWING morning (zman.ts's `rollsIntoNextDay`), so sorting by instant
 * is what puts it last on its own row's list instead of first — which is
 * where a naive "1:27 AM sorts before 6:00 AM" would put it. Nothing here
 * special-cases it; the instant already carries the answer, and this
 * function only has to not throw that away by sorting on the rendered
 * string.
 *
 * `date` is a civil date in the shul's own zone. The caller decides which
 * one — see `resolveZmanimTable` for the today/tomorrow rule.
 */
export function resolveZmanimForDate(input: {
  date: string;
  ids: readonly string[];
  provider: "hebcal" | "chabad" | "myzmanim" | "manual";
  location: BoardLocation;
  chabadZmanim: ChabadZmanimByDate | null;
  fallbackToCalculated: boolean;
  hour12: boolean;
  /** Precomputed by the caller so a two-day resolve scans the cache once
   *  rather than twice. Optional: a single-date call can omit it. */
  labels?: Record<string, string>;
}): ResolvedZman[] {
  const { date, ids, provider, location, chabadZmanim, fallbackToCalculated, hour12 } = input;
  const labels = input.labels ?? harvestLabels(chabadZmanim);
  const isChabad = provider === "chabad";
  const selected = new Set(ids);

  const labelFor = (id: string) => labels[id] ?? ZMAN_PANEL_LABEL[id] ?? id;

  const rows: ResolvedZman[] = [];

  for (const id of ids) {
    // Chabad's cache first, for every id. Hebcal and manual skip straight
    // to the computation — they are the computed path, so there is no
    // provider value for them to be missing and `fallbackToCalculated` has
    // nothing to say about them.
    if (isChabad) {
      const direct = cachedClock(chabadZmanim, date, id);
      if (direct) {
        rows.push({
          id,
          label: labelFor(id),
          time: new Date(direct.iso),
          display: direct.display,
          fellBackToHebcal: false,
          footnote: direct.footnote?.text ?? null,
          suppliedBy: null,
        });
        continue;
      }

      /*
       * THE SUBSTITUTION — the single most important behaviour in this
       * module. See `ZMAN_SUBSTITUTE`: Chabad publishes one nightfall a day
       * and relabels it on the 17 days a Shabbos or Yom Tov ends, so a
       * board asking for nightfall is blank every Shabbos without this.
       *
       * Skipped when the substitute is ITSELF selected, or the board shows
       * the same value twice under two labels on exactly those days —
       * which is the failure a naive substitution introduces in place of
       * the one it fixes.
       */
      const substituteId = ZMAN_SUBSTITUTE[id];
      if (substituteId && !selected.has(substituteId)) {
        const substitute = cachedClock(chabadZmanim, date, substituteId);
        if (substitute) {
          rows.push({
            id,
            // The SUBSTITUTE's own label, so the board says "Shabbat Ends"
            // rather than calling an 8.5° time "Nightfall". That relabel
            // is the whole disclosure — nothing else flags this row.
            label: labelFor(substituteId),
            time: new Date(substitute.iso),
            display: substitute.display,
            fellBackToHebcal: false,
            footnote: substitute.footnote?.text ?? null,
            suppliedBy: substituteId,
          });
          continue;
        }
      }

      // Cache miss on a Chabad board. The shul may have asked for its own
      // source or nothing.
      if (!fallbackToCalculated) continue;
    }

    const computed = computeZman(id, date, location);
    if (!computed) continue; // Not computable — candle_lighting, shabbos_ends.

    rows.push({
      id,
      label: labelFor(id),
      time: computed,
      display: formatComputed(computed, { hour12, timeZone: location.timeZone }),
      // Hebcal and manual ARE the computed path; only a Chabad board that
      // fell through to here is showing a stand-in.
      fellBackToHebcal: isChabad,
      footnote: null,
      suppliedBy: null,
    });
  }

  return rows.sort((a, b) => a.time.getTime() - b.time.getTime());
}

/**
 * What the widget renders: today's table, plus whichever row is next.
 *
 * TODAY, in the shul's own zone, and not "the next 24 hours" — a luach on
 * a wall shows one date's times, including the ones already past, and this
 * is that. A board at 2 AM showing today's alos as past is correct rather
 * than stale.
 *
 * `next` reaches into TOMORROW, which `all` does not, and it has to: by
 * 2 AM every one of today's rows is behind, so a "next upcoming" that only
 * looked at today would show nothing for the last few hours of every
 * night. Tomorrow's table is resolved for that alone.
 */
export function resolveZmanimTable(input: {
  now: Date;
  ids: readonly string[];
  provider: "hebcal" | "chabad" | "myzmanim" | "manual";
  location: BoardLocation;
  chabadZmanim: ChabadZmanimByDate | null;
  fallbackToCalculated: boolean;
  hour12: boolean;
}): { today: ZmanimResolution; next: ResolvedZman | null } {
  const labels = harvestLabels(input.chabadZmanim);
  const date = isoDateInZone(input.now, input.location.timeZone);

  const today = resolveZmanimForDate({ ...input, date, labels });
  const tomorrow = resolveZmanimForDate({ ...input, date: addDays(date, 1), labels });

  const next =
    [...today, ...tomorrow].find((row) => row.time.getTime() > input.now.getTime()) ?? null;

  return {
    today: today.length > 0 ? { status: "ok", rows: today } : { status: "unavailable" },
    next,
  };
}
