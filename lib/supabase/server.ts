import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/**
 * The server client, reading and writing the session cookie.
 *
 * Still the anon key. Server-side does not mean privileged here: these queries go
 * through RLS exactly like the browser's, and nothing in the dashboard bypasses a
 * policy for convenience. The service-role key belongs only to the display bundle
 * route and its siblings, and appears nowhere in the authenticated app.
 */
export async function createClient() {
  // cookies() first, deliberately. Reading it is what marks the route dynamic,
  // and if the env check threw ahead of it the build would try to prerender an
  // authenticated page and fail with a configuration error instead of simply
  // rendering it per request.
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the
          // session on every request, so a failure here is expected and harmless.
        }
      },
    },
  });
}
