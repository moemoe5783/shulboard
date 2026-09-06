/**
 * Screen status, phrasing and resolution.
 *
 * No node imports here on purpose: the screens table renders on the client, so
 * anything in this file has to be safe in the browser. Token generation, which
 * needs real randomness, lives with the server actions instead.
 */

export type ScreenStatus = "live" | "stale" | "offline";

/**
 * How long a screen may go quiet before it stops counting as live.
 *
 * The display posts a heartbeat every 60 seconds (plan.md §3e), so three
 * minutes is two missed beats — long enough to ride out a slow network, short
 * enough that a dark screen goes amber quickly.
 *
 * Three days for stale comes from the wireframe in design.md §4, which marks a
 * screen last seen "3 days" ago as --stale rather than --offline. That is the
 * right call for a room like a simcha hall, which is legitimately dark between
 * events. Both numbers are here, together, because they are the kind of thing
 * that gets tuned once real screens are running.
 */
const LIVE_WITHIN_MS = 3 * 60 * 1000;
const STALE_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;

export function screenStatus(lastSeenAt: string | null, now = Date.now()): ScreenStatus {
  if (!lastSeenAt) return "offline";

  const elapsed = now - new Date(lastSeenAt).getTime();
  if (elapsed < LIVE_WITHIN_MS) return "live";
  if (elapsed < STALE_WITHIN_MS) return "stale";
  return "offline";
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Plain language, and never a duration in units nobody says out loud.
 *
 * "3 days", not "72h ago". Prose, so it stays in Assistant — only columns of
 * clock times get the sefarim face.
 */
export function lastSeenLabel(lastSeenAt: string | null, now = Date.now()): string {
  if (!lastSeenAt) return "Never";

  const elapsed = now - new Date(lastSeenAt).getTime();
  if (elapsed < LIVE_WITHIN_MS) return "now";

  if (elapsed < HOUR) {
    const minutes = Math.max(1, Math.round(elapsed / MINUTE));
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  if (elapsed < DAY) {
    const hours = Math.round(elapsed / HOUR);
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }

  const days = Math.round(elapsed / DAY);
  if (days <= 30) return days === 1 ? "1 day" : `${days} days`;

  const months = Math.round(days / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

/** The resolutions a screen can be set to, from plan.md §4a. */
export const RESOLUTIONS = [
  { id: "1080p", label: "1080p landscape", width: 1920, height: 1080 },
  { id: "4k", label: "4K landscape", width: 3840, height: 2160 },
  { id: "1080p-portrait", label: "1080p portrait", width: 1080, height: 1920 },
  { id: "4k-portrait", label: "4K portrait", width: 2160, height: 3840 },
] as const;

export type ResolutionId = (typeof RESOLUTIONS)[number]["id"];

export function resolutionById(id: string) {
  return RESOLUTIONS.find((resolution) => resolution.id === id) ?? null;
}

/** What the Size column says. Falls back to the raw dimensions, which is still
 * information rather than a shrug. */
export function formatResolution(width: number, height: number): string {
  const known = RESOLUTIONS.find(
    (resolution) => resolution.width === width && resolution.height === height,
  );
  if (known) return known.label.replace(" landscape", "");
  return `${width} × ${height}`;
}
