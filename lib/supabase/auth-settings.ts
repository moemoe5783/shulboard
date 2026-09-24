import "server-only";

import { isSupabaseConfigured, supabaseEnv } from "./env";

/*
 * Which sign-in methods the Supabase project actually has turned on, from its
 * public settings endpoint (GET /auth/v1/settings — anon key, no user). So the
 * sign-in page offers "Continue with Google" only once Google is enabled in
 * Supabase (Authentication → Providers → Google), and shows it by itself the
 * moment it is — no deploy, no flag to remember.
 *
 * Cached for five minutes. If Supabase can't be asked, the answer is "no":
 * a missing button is better than one that can only fail.
 */
export async function enabledSignInProviders(): Promise<{ google: boolean }> {
  if (!isSupabaseConfigured()) return { google: false };
  const { url, anonKey } = supabaseEnv();
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { google: false };
    const body = (await response.json()) as { external?: Record<string, boolean> };
    return { google: body.external?.google === true };
  } catch {
    return { google: false };
  }
}
