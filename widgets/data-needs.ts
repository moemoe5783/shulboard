import type { DataNeed } from "./types";

/*
 * Data needs, and the one operation that makes them worth being objects.
 *
 * Its own module rather than part of the registry: the registry resolves its
 * folder through a bundler, and this has to be runnable — and testable —
 * without one. Nothing consumes these yet; the bundle builder is P3.
 */

/**
 * A stable identity for one need, so needs can be deduped.
 *
 * Keys are SORTED, because two widgets declaring the same need in a different
 * property order are the same need — and a builder that missed that would make
 * exactly the duplicate API call the whole field exists to prevent. Undefined
 * parameters are dropped, so omitting one and passing it as undefined agree.
 */
export function dataNeedKey(need: DataNeed): string {
  return JSON.stringify(
    Object.keys(need)
      .filter((key) => need[key] !== undefined)
      .sort()
      .map((key) => [key, need[key]]),
  );
}

/**
 * Every distinct need in a list, first occurrence kept.
 *
 * This is the shape of what the bundle builder does: collect the needs of every
 * widget on every board, run them through here, and fetch what comes out.
 */
export function dedupeDataNeeds(needs: readonly DataNeed[]): DataNeed[] {
  const seen = new Map<string, DataNeed>();
  for (const need of needs) {
    const key = dataNeedKey(need);
    if (!seen.has(key)) seen.set(key, need);
  }
  return [...seen.values()];
}
