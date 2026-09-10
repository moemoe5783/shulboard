/*
 * Time-of-day parsing and wall-clock-to-instant conversion, shared by both
 * Chabad readers: the Get_Zmanim JSON adapter (chabad-adapter.ts, live)
 * and the published candle-lighting embed (chabad-embed.ts, kept but
 * unwired as a fallback). Extracted here so neither imports from the
 * other — which side is live has already swapped once.
 *
 * Neither of them is `server-only` because of this file — it is pure
 * arithmetic over `Intl`, no fetch and no key.
 */

/** "7:22 PM" -> {hour: 19, minute: 22}. Both Chabad surfaces render a
 *  time this way and nothing more — no date, no timezone marker. The JSON
 *  endpoint puts it in `Zman`; the embed puts it at the end of a phrase
 *  like "Light Shabbat / Holiday Candles at&nbsp;7:22 PM". */
export function parseZmanTime(value: unknown): { hour: number; minute: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (!match) return null;
  const minute = Number(match[2]);
  let hour = Number(match[1]) % 12;
  if (/pm/i.test(match[3])) hour += 12;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * A wall-clock date and time in a specific IANA zone, as the UTC instant it
 * actually refers to — the exact inverse of lib/hebrew/civil-day.ts's
 * `civilDateInZone` (Date -> wall-clock parts in a zone), needed here
 * because this project has no library for the reverse direction.
 *
 * The offset-by-round-trip technique: guess the instant by treating the
 * wall-clock numbers as if they were already UTC, ask
 * `Intl.DateTimeFormat` what wall-clock time that guess actually displays
 * as in the target zone, and shift the guess by the difference.
 *
 * TWO PASSES, NOT ONE, AND THE SECOND ONE IS A BUG FIX RATHER THAN
 * DEFENSIVENESS.
 *
 * The offset has to be read at the ANSWER, not at the guess, and those are
 * four or five hours apart in the Americas — so a DST transition sitting
 * between them makes a one-pass answer exactly an hour wrong. That is not
 * hypothetical: on 1 November 2026 America/New_York falls back at 2 AM
 * (06:00 UTC), and Chabad's alos for that date is 5:27 AM. One pass guesses
 * 05:27Z, reads EDT there (the transition is still 33 minutes away), and
 * lands on 09:27Z — which is 4:27 AM EST, an hour early. The second pass
 * reads the offset at 09:27Z, gets EST, and lands on the correct 10:27Z.
 *
 * This module's previous comment argued one pass was enough because "DST
 * changes happen at 2 AM, not at sunset." That was true while the only
 * caller was candle lighting. It stopped being true the moment
 * chabad-adapter.ts began caching alos, misheyakir and netz — morning
 * zmanim, in the 2 AM-to-6 AM local window where the guess and the answer
 * straddle the transition. Every local time in that window on a fall-back
 * day was cached an hour early until this second pass existed.
 *
 * A second pass is enough for every real case, and it is idempotent
 * wherever one pass was already right: when the offset at the answer
 * equals the offset at the guess, the second shift reproduces the first.
 * Notably it does NOT disturb the ambiguous hour — 1:14 AM on a fall-back
 * day guesses 01:14Z, which is still the previous evening in the target
 * zone, so both passes read EDT and the answer stays the FIRST of the two
 * 1:14 AMs, which is the one a solar midpoint means.
 *
 * A third pass would only matter for a wall-clock time that does not exist
 * (the skipped hour on a spring-forward day), where no answer is correct by
 * definition. No zman lands there: the skipped hour is 2-3 AM local, and
 * the latest thing this caches in the small hours is chatzos halayla, which
 * runs from around midnight to 1:30.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);

  /** The zone's offset from UTC at `instant`, in milliseconds — negative
   *  west of Greenwich. Read by round-trip rather than from a table,
   *  because `Intl` is the only thing here that knows a zone's rules. */
  const offsetAt = (instant: number): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));

    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const shownAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return shownAsUtc - instant;
  };

  const firstPass = guess - offsetAt(guess);
  return new Date(guess - offsetAt(firstPass));
}
