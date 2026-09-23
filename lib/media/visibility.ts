/*
 * "Is this photo still showing?" — album_items.display_until, resolved.
 *
 * A photo's end date is a civil date in the shul's own zone: "stop showing it
 * after the 14th" means through the end of the 14th where the shul is, not in
 * UTC and not wherever the viewing device happens to think it is. Pure and
 * clock-injected, so the album page (which labels the photos), the Gallery and
 * Collage widgets (which skip them, offline, at the right midnight) and the
 * tests all agree.
 */

/** Today's date, `YYYY-MM-DD`, in `timeZone` (the device's own zone if none). */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  const format = (zone: string | undefined) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timeZone ?? undefined);
  } catch {
    // An unknown zone name on file shouldn't blank a board — fall back to the device.
    parts = format(undefined);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whether a photo with this end date is still shown on `today`. The end date
 *  itself is the LAST day it shows. ISO dates compare correctly as strings. */
export function isShowing(displayUntil: string | null | undefined, today: string): boolean {
  return !displayUntil || displayUntil >= today;
}

/** "14 Mar 2026", for labels. Formatted in UTC because the value is a plain date. */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
