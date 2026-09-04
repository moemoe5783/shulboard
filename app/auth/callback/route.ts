import { NextResponse, type NextRequest } from "next/server";
import { SIGN_IN_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Where both sign-in methods land: the magic link and the Google redirect.
 *
 * Exchanges the one-time code for a session and writes the cookie. Anon key, like
 * everything else in the dashboard.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const from = searchParams.get("from");
  const next = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";

  if (!code) {
    const target = new URL(SIGN_IN_PATH, origin);
    target.searchParams.set(
      "error",
      "That sign-in link is missing its code. Ask for a new one.",
    );
    return NextResponse.redirect(target);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const target = new URL(SIGN_IN_PATH, origin);
    // What happened and what to do, not an apology.
    target.searchParams.set(
      "error",
      "That sign-in link has expired or was already used. Ask for a new one.",
    );
    return NextResponse.redirect(target);
  }

  return NextResponse.redirect(new URL(next, origin));
}
