import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { INVITE_PATH_PREFIX, MFA_VERIFY_PATH, SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/routes";
import { isSupabaseConfigured, supabaseEnv } from "./env";

/**
 * Paths that never require a session.
 *
 * `/s/` is the display route: a TV in a lobby has no session and must never be
 * asked for one. It authenticates with the screen token instead, in a server
 * route, and nothing in this file should ever get in its way.
 */
const PUBLIC_PREFIXES = [
  "/s/",
  // The display's own endpoints. They authenticate with a screen token and the
  // service role, not a session — sending them to /sign-in would mean a
  // television in a lobby following a redirect it cannot satisfy. The cron
  // worker checks a shared secret for the same reason.
  "/api/screen/",
  "/api/cron/",
  // TV pairing: a TV asking for a code, and checking whether it was entered.
  "/api/pair/",
  // The page a TV opens to be paired.
  "/pair",
  // The media proxy: immutable asset paths, no session (schema.md §6).
  "/m/",
  // The service worker must be reachable without a session or it can never
  // register, and its scope is /s/ regardless.
  "/sw.js",
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  "/auth/",
  // An invitation shows who's inviting before the invitee has an account.
  INVITE_PATH_PREFIX,
  // Dev reference sheets. Remove these when the app ships.
  "/tokens",
  "/primitives",
  "/editor-lab",
  "/font-parity",
  "/zmanim-lab",
  "/collage-lab",
  "/backgrounds-lab",
  "/clock-lab",
  "/widgets-lab",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix),
  );
}

/**
 * Refreshes the session cookie and turns away signed-out visitors.
 *
 * Called from proxy.ts — Next 16's replacement for the middleware convention.
 *
 * The response object has to be the one the Supabase client wrote its cookies
 * onto — building a fresh NextResponse here would silently drop a refreshed token
 * and sign the user out at an unpredictable interval.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Fail closed. With no keys configured nobody can be authenticated, so
  // protected paths still refuse rather than falling open.
  if (!isSupabaseConfigured()) {
    return isPublic(pathname) ? NextResponse.next() : redirectToSignIn(request);
  }

  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser, not getSession: getSession trusts whatever is in the cookie, and
  // this is the check that decides whether a request reaches the dashboard.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(pathname)) {
    return redirectToSignIn(request);
  }

  // Two-step sign-in. An account with an authenticator app is only half signed
  // in after its password (aal1) and must give a code (aal2) before anything
  // behind the sign-in wall. Read from the verified session, no network call.
  // The database enforces the same rule (the mfa_satisfied() policies), so this
  // redirect is the courtesy and not the lock.
  if (user && !isPublic(pathname)) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const url = request.nextUrl.clone();
      url.pathname = MFA_VERIFY_PATH;
      url.search = "";
      const from = request.nextUrl.pathname + request.nextUrl.search;
      if (from !== "/") url.searchParams.set("from", from);
      const redirect = NextResponse.redirect(url);
      // Keep any refreshed session cookie the check above may have written.
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return redirect;
    }
  }

  return response;
}

function redirectToSignIn(request: NextRequest): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = SIGN_IN_PATH;
  target.search = "";
  // So the user lands where they were headed once they are signed in.
  const from = request.nextUrl.pathname + request.nextUrl.search;
  if (from !== "/") {
    target.searchParams.set("from", from);
  }
  return NextResponse.redirect(target);
}
