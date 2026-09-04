/**
 * The only two Supabase values the browser is ever given.
 *
 * NEXT_PUBLIC_* variables are inlined at build time, so these are read inside a
 * function rather than at module load: the project has to build and deploy with
 * no Supabase keys present, and a module-level throw would break that.
 *
 * The service-role key is not here and must never be. Nothing in this file is
 * server-only, so anything it exports reaches the browser.
 */

export type SupabaseEnv = { url: string; anonKey: string };

export function supabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY — see .env.example.",
    );
  }

  return { url, anonKey };
}

/** True when both variables are present, so callers can degrade rather than throw. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
