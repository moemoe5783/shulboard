"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { readSupabaseEnv, supabaseEnv } from "./env";

/**
 * The browser client. Anon key only — every query it makes is subject to RLS,
 * which is the point.
 *
 * Typed against the generated schema (lib/database.types.ts) so a wrong table
 * or column name is a compile error here, not a `PostgrestError` a user finds
 * first.
 */
export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}

/** The configured project URL, for error messages. Null when unusable. */
export function supabaseUrl(): string | null {
  const result = readSupabaseEnv();
  return result.ok ? result.env.url : null;
}
