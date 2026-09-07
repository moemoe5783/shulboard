import { createHash } from "node:crypto";
import type { BundlePayload } from "./types";

/*
 * The content hash — docs/schema.md §9, served verbatim as the ETag.
 *
 * CANONICAL, NOT JSON.stringify. Key order in JSON.stringify is insertion order,
 * and rows come back from Postgres as objects whose key order is a property of
 * the query plan rather than of the content. Hash that directly and two builds
 * of identical content produce different hashes: `version` bumps, every screen
 * refetches and cross-fades, and the "version bumps only on real change" rule
 * quietly stops being true — while every test that builds twice in a row from
 * the same fixture still passes, because a fixture has stable key order.
 *
 * So keys are sorted, all the way down. Arrays keep their order, because an
 * array's order is content: a playlist is a sequence.
 */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // undefined is absent, not a value. A field omitted and a field set to
    // undefined must hash the same or an optional column flips the hash.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** sha256 of the canonical form. Hex, lower case, no prefix — the ETag is this
 *  string in quotes and nothing else. */
export function hashPayload(payload: BundlePayload): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function payloadBytes(payload: BundlePayload): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

/**
 * Does this request's If-None-Match match what we hold?
 *
 * Handles the quoting and the weak-validator prefix that proxies add, and the
 * `*` form. A comparison that forgot the quotes would never match, every poll
 * would return 200 with a full payload, and the only symptom would be a bandwidth
 * bill — which is exactly the kind of bug that survives to production.
 */
export function etagMatches(ifNoneMatch: string | null, contentHash: string): boolean {
  if (!ifNoneMatch) return false;

  return ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, "").replace(/^"|"$/g, ""))
    .some((candidate) => candidate === "*" || candidate === contentHash);
}

export const etagFor = (contentHash: string) => `"${contentHash}"`;
