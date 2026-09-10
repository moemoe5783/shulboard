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
 * The standard offset-by-round-trip technique: guess the instant by
 * treating the wall-clock numbers as if they were already UTC, ask
 * `Intl.DateTimeFormat` what wall-clock time that guess actually displays
 * as in the target zone, and shift the guess by the difference. One pass
 * is enough here — the zone's offset from UTC is constant across the few
 * minutes this could be off by on a first guess, so a second pass could
 * only change the answer at a DST transition falling in that exact
 * window, which candle lighting never does (DST changes happen at 2 AM,
 * not at sunset).
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const shownAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));

  return new Date(guess - (shownAsUtc - guess));
}
