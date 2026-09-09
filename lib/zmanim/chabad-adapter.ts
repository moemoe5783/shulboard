import "server-only";

/*
 * Chabad.org's undocumented zmanim endpoint, read into this project's own
 * `{iso, display}` vocabulary — plan.md §5c / §10.4.
 *
 * UNOFFICIAL. NO ToS. PROVISIONAL. There is no published contract for this
 * endpoint — plan.md §10.4 names the conversation with Chabad.org that
 * hasn't happened yet, covering this exact access. This module exists so
 * the infrastructure is ready the day that conversation resolves, not as a
 * claim that scraping it today is settled or permitted. It is gated off by
 * default (ZMANIM_CHABAD_ENABLED, docs/environment.md) for exactly this
 * reason — this comment is documentation, not the gate itself; nothing
 * here checks it, because a runtime check on a comment is theater. Whoever
 * flips the flag on is the one who has had that conversation, or decided
 * not to wait for it.
 *
 * The exact response shape below (Days / TimeGroups / Items, which item is
 * candle lighting) is reconstructed from a third-party open-source client
 * for this same endpoint (`chabad-org-zmanim` on npm) rather than from a
 * live call — this sandbox cannot reach chabad.org. VERIFY AGAINST ONE REAL
 * RESPONSE before this ever runs against a real shul. `rawResponse` is
 * stored untouched specifically so a shape mismatch is diagnosable after
 * the fact rather than a silent empty `times`.
 */

const ENDPOINT = "https://www.chabad.org/webservices/zmanim/zmanim/Get_Zmanim";

export type ChabadZman = { iso: string; display: string };

export type ChabadZmanimResult = {
  /** Canonical zman id -> value. Only `candle_lighting` today (plan §5c's
   *  own spelling) — the one thing widgets/candle-lighting needs. */
  times: Record<string, Record<string, ChabadZman>>;
  /** The untouched fetch body, one entry per returned day, keyed the same
   *  way `times` is. Stored verbatim in zmanim_cache.raw_response — this
   *  endpoint can change shape with no notice, and this is the only way to
   *  tell why a mapping started coming back empty. */
  rawResponseByDate: Record<string, unknown>;
};

/**
 * ASP.NET's own JSON date encoding, e.g. `/Date(1730937600000)/` — a plain
 * `Date.parse` silently returns `Invalid Date` on this, which is why
 * plan.md's ask calls this unwrap out specifically rather than trusting a
 * generic parser to handle it.
 */
function parseAspNetDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = /\/Date\((-?\d+)\)\//.exec(value);
  if (!match) return null;
  const ms = Number(match[1]);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Loose on purpose: the exact property names below are the unverified part
 *  of this file (see the header comment). Every item in a TimeGroup is
 *  checked against a handful of plausible label fields and a
 *  case-insensitive "candle" match, rather than one hardcoded key, so a
 *  small naming difference in the real payload doesn't produce a silently
 *  empty result the first time this actually runs. */
function isCandleLightingItem(item: Record<string, unknown>): boolean {
  const label = String(item.Name ?? item.Caption ?? item.Title ?? item.Type ?? "");
  return /candle/i.test(label);
}

function itemTime(item: Record<string, unknown>): Date | null {
  return parseAspNetDate(item.Time ?? item.Zman ?? item.DateTime);
}

function formatDisplay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

/**
 * One (chabad, location) pair's zmanim for the given date range, ready to
 * upsert into `zmanim_cache` one row per date.
 *
 * `timeZone` is needed only to render `display` the way this project's own
 * `formatTimeOfDay` would (lib/hebrew/format.ts) — plan §5c's "never
 * re-round or recompute provider output" is about the *value*, not its
 * string rendering, and Chabad's own rendered string isn't necessarily
 * reachable from this endpoint's raw items the way it is from their HTML
 * pages, so this project renders it instead of inventing a second display
 * convention.
 */
export async function fetchChabadZmanim(input: {
  locationId: string;
  locationType: "1" | "2";
  startDate: string;
  endDate: string;
  timeZone: string;
}): Promise<ChabadZmanimResult> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("locationid", input.locationId);
  url.searchParams.set("locationtype", input.locationType);
  url.searchParams.set("save", "1");
  url.searchParams.set("tdate", input.startDate);
  url.searchParams.set("startdate", input.startDate);
  url.searchParams.set("enddate", input.endDate);
  url.searchParams.set("jewish", "Zmanim-Halachic-Times.htm");
  // Deliberately no `aid` parameter — confirmed by hand not to be required.

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Chabad zmanim request failed: ${response.status} ${response.statusText}`);
  }

  const body: unknown = await response.json();
  const days = Array.isArray((body as { Days?: unknown[] })?.Days) ? (body as { Days: unknown[] }).Days : [];

  const times: Record<string, Record<string, ChabadZman>> = {};
  const rawResponseByDate: Record<string, unknown> = {};

  for (const day of days) {
    const dayRecord = day as Record<string, unknown>;
    const dayDate = parseAspNetDate(dayRecord.Date);
    if (!dayDate) continue;
    const isoDate = dayDate.toISOString().slice(0, 10);

    rawResponseByDate[isoDate] = day;

    const groups = Array.isArray(dayRecord.TimeGroups) ? (dayRecord.TimeGroups as unknown[]) : [];
    for (const group of groups) {
      const items = Array.isArray((group as Record<string, unknown>).Items)
        ? ((group as Record<string, unknown>).Items as unknown[])
        : [];
      for (const rawItem of items) {
        const item = rawItem as Record<string, unknown>;
        if (!isCandleLightingItem(item)) continue;
        const time = itemTime(item);
        if (!time) continue;
        times[isoDate] ??= {};
        times[isoDate].candle_lighting = { iso: time.toISOString(), display: formatDisplay(time, input.timeZone) };
      }
    }
  }

  return { times, rawResponseByDate };
}
