/*
 * How long deleted photos wait before they're gone for good — the one place
 * these numbers live. Read by the cleanup job (app/api/cron/clean-media) and
 * by Media's "Recently deleted" page, which counts down to the same date.
 *
 * Client-safe: plain numbers and date arithmetic, no server imports.
 */

/** A deleted photo or album can be restored for this many days. */
export const TRASH_RETENTION_DAYS = 30;

/** An upload still 'pending' after this long was abandoned (its tab closed). */
export const STALE_PENDING_HOURS = 24;

/** A file nothing claims is only removed once it's this old, so an upload in
 *  progress right now is never mistaken for an orphan. */
export const ORPHAN_MIN_AGE_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When something deleted at `deletedAt` is permanently deleted. */
export function permanentDeletionDate(deletedAt: string): Date {
  return new Date(Date.parse(deletedAt) + TRASH_RETENTION_DAYS * DAY_MS);
}

/** Whole days left before permanent deletion, never below zero. */
export function daysUntilPermanentDeletion(deletedAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((permanentDeletionDate(deletedAt).getTime() - now) / DAY_MS));
}
