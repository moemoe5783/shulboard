"use client";

import { createBrowserClient } from "@supabase/ssr";
import { readSupabaseEnv, supabaseEnv } from "./env";

/**
 * The browser client. Anon key only — every query it makes is subject to RLS,
 * which is the point.
 */
export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}

/** The configured project URL, for error messages. Null when unusable. */
export function supabaseUrl(): string | null {
  const result = readSupabaseEnv();
  return result.ok ? result.env.url : null;
}
