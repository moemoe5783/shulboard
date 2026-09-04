import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
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
  "/sign-in",
  "/auth/",
  // Dev reference sheets. Remove these when the app ships.
  "/tokens",
  "/primitives",
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

  const supabase = createServerClient(url, anonKey, {
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

  return response;
}

function redirectToSignIn(request: NextRequest): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = "/sign-in";
  target.search = "";
  // So the user lands where they were headed once they are signed in.
  const from = request.nextUrl.pathname + request.nextUrl.search;
  if (from !== "/") {
    target.searchParams.set("from", from);
  }
  return NextResponse.redirect(target);
}
