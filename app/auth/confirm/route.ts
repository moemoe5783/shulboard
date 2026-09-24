import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { NEW_PASSWORD_PATH, SIGN_IN_PATH, safeNext } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Where every account email's link lands — confirm your email, sign-in link,
 * reset your password, change of email. The template appends a one-time
 * `token_hash` and its `type` to the address the app asked for
 * (`/auth/confirm?next=…`, see app/(auth)/shared.ts), and this verifies it on
 * the server, which writes the session cookie.
 *
 * Verifying the token here, rather than exchanging a PKCE code, is what lets a
 * link opened on a phone work when it was requested on the office computer.
 * Anon key, like the rest of the dashboard.
 */
const TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

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
