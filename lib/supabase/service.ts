import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/*
 * THE SERVICE-ROLE CLIENT. THE ONLY ONE IN THE PRODUCT.
 *
 * CLAUDE.md: the service-role key is used only in server-only code, never in a
 * client component, never in app/s/, never in a file that does not import
 * `server-only`. That import is the first line of this file and it is what makes
 * the rule enforceable rather than aspirational — a client component importing
 * this fails the build.
 *
 * It bypasses RLS entirely. Every caller must therefore do its own
 * authorisation: the bundle route validates a screen token, the heartbeat route
 * validates a screen token, the build worker validates a shared secret. There is
 * no policy behind any of them to catch a mistake.
 *
 * The key is read per call rather than at module load, so a build with no
 * environment configured still succeeds — the same reason the anon client reads
 * its env lazily.
 */

let cached: SupabaseClient<Database> | null = null;

export class ServiceKeyMissingError extends Error {
  constructor() {
    super(
      "SUPABASE_SERVICE_ROLE_KEY is not set. The bundle and heartbeat routes cannot run without it.",
    );
    this.name = "ServiceKeyMissingError";
  }
}

export function serviceClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ServiceKeyMissingError();

  cached = createClient<Database>(url, key, {
    // No session, no cookie, no refresh. This client is a server process acting
    // as itself, and persisting anything here would be a shared mutable session
    // across every request the instance handles.
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}

/** For routes that must answer rather than throw when nothing is configured. */
export function serviceClientOrNull(): SupabaseClient<Database> | null {
  try {
    return serviceClient();
  } catch {
    return null;
  }
}
