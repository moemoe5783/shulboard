import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { NEW_PASSWORD_PATH, SIGN_IN_PATH, safeNext } from "@/lib/routes";
import { requestOrigin } from "@/lib/origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Where every account email's link lands — confirm your email, sign-in link,
 * reset your password, change of email. The template sends a one-time
 * `token_hash`, its `type`, and the address the app asked for
 * (lib/email/templates.ts), and this verifies the token on the server, which
 * writes the session cookie.
 *
 * Verifying the token here, rather than exchanging a PKCE code, is what lets a
 * link opened on a phone work when it was requested on the office computer.
 * Anon key, like the rest of the dashboard.
 */
const TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/**
 * Where to go after. The templates pass the address the app asked for as
 * `redirect_to` — normally this same route with `?next=/somewhere`
 * (app/(auth)/shared.ts), or just the site's address when the email came from
 * the Supabase dashboard. `next` directly is honoured too. Only a path on this
 * site is ever used.
 */
function nextFrom(searchParams: URLSearchParams, origin: string): string {
  const direct = searchParams.get("next");
  if (direct) return safeNext(direct);
  const raw = searchParams.get("redirect_to");
  if (!raw) return "/";
  try {
    const target = new URL(raw, origin);
    if (target.origin !== origin) return "/";
    if (target.pathname === "/auth/confirm") return safeNext(target.searchParams.get("next"));
    return safeNext(target.pathname + target.search);
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // The address the browser used (Host header), not the one the server
  // listens on — they differ behind a proxy and in local runs.
  const origin = await requestOrigin();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = nextFrom(searchParams, origin);

  const fail = (message: string) => {
    const target = new URL(SIGN_IN_PATH, origin);
    target.searchParams.set("error", message);
    if (next !== "/") target.searchParams.set("from", next);
    return NextResponse.redirect(target);
  };

  if (!tokenHash || !type || !TYPES.has(type)) {
    return fail("That link is missing part of its address. Ask for a new one.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return fail("That link has expired or was already used. Ask for a new one.");

  // A reset link signs you in only so you can choose a new password.
  if (type === "recovery") {
    const target = new URL(NEW_PASSWORD_PATH, origin);
    if (next !== "/") target.searchParams.set("next", next);
    return NextResponse.redirect(target);
  }
  return NextResponse.redirect(new URL(next, origin));
}
