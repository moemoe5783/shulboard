/**
 * The only two Supabase values the browser is ever given.
 *
 * The service-role key is not here and must never be. Nothing in this file is
 * server-only, so anything it exports reaches the browser.
 *
 * A build-time/runtime split worth knowing about: Next inlines NEXT_PUBLIC_*
 * into the CLIENT bundle when it builds, but server code reads process.env at
 * request time. So adding these variables in a hosting dashboard without
 * redeploying leaves the server seeing them and the browser not. That is why the
 * sign-in form checks configuration on the client rather than trusting the page
 * that rendered it.
 */

export type SupabaseEnv = { url: string; anonKey: string };

export type SupabaseEnvResult =
  | { ok: true; env: SupabaseEnv }
  | { ok: false; problem: string };

/**
 * Reads and validates both variables.
 *
 * Shape matters, not just presence. An unreachable URL fails at fetch time with
 * a bare "Failed to fetch" from the browser, which says nothing about the cause;
 * catching a malformed one here turns that into a sentence naming the variable.
 */
export function readSupabaseEnv(): SupabaseEnvResult {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!rawUrl || !anonKey) {
    return {
      ok: false,
      problem:
        "Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy — the browser only gets " +
        "these at build time, so setting them without a new build changes nothing.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      problem: `NEXT_PUBLIC_SUPABASE_URL isn't a URL: ${rawUrl}. It should look like https://your-project.supabase.co`,
    };
  }

  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    return {
      ok: false,
      problem: `NEXT_PUBLIC_SUPABASE_URL must start with https://, not ${parsed.protocol}//`,
    };
  }

  // The dashboard URL is the one people copy by mistake — it's what's in the
  // address bar when you go looking for the key. Requests to it fail CORS and
  // surface as "Failed to fetch", with nothing pointing at the cause.
  if (parsed.pathname !== "/" || parsed.hostname === "supabase.com") {
    return {
      ok: false,
      problem: `NEXT_PUBLIC_SUPABASE_URL looks like a dashboard link (${rawUrl}). Use the Project URL from Supabase settings, which is just a host: https://your-project.supabase.co`,
    };
  }

  // origin drops a trailing slash and any stray path.
  return { ok: true, env: { url: parsed.origin, anonKey } };
}

export function supabaseEnv(): SupabaseEnv {
  const result = readSupabaseEnv();
  if (!result.ok) throw new Error(result.problem);
  return result.env;
}

/** True when both variables are present AND usable, so callers can degrade
 * rather than throw. A malformed URL counts as unconfigured, which keeps the
 * proxy failing closed instead of returning a 500 on every request. */
export function isSupabaseConfigured(): boolean {
  return readSupabaseEnv().ok;
}

/** The problem, or null when everything is in order. For showing a person. */
export function supabaseConfigProblem(): string | null {
  const result = readSupabaseEnv();
  return result.ok ? null : result.problem;
}
