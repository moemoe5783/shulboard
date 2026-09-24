/*
 * What the sign-in, sign-up and reset forms share: the words for a failure,
 * and the addresses their emails and redirects come back to.
 */

/**
 * A network failure from supabase-js arrives as "Failed to fetch", which is the
 * browser saying the request never completed and nothing else. The usual causes
 * are a wrong project URL, a paused project, or a build that predates the
 * environment variables — so name them, rather than repeating the browser.
 */
export function describeAuthError(error: { message: string; code?: string }, url: string | null): string {
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
    return (
      `Couldn't reach Supabase${url ? ` at ${url}` : ""}. Check that the project ` +
      `is running and not paused, that NEXT_PUBLIC_SUPABASE_URL points at it, and ` +
      `that this build was made after those variables were set.`
    );
  }
  if (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message)) {
    return "That email and password don't match an account. Check them, or reset your password.";
  }
  if (error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message)) {
    return "This email hasn't been confirmed yet. Open the link in the email we sent, or ask for a sign-in link instead.";
  }
  if (error.code === "user_already_exists" || /already registered/i.test(error.message)) {
    return "There's already an account with this email. Sign in instead.";
  }
  if (error.code === "weak_password" || /password should be/i.test(error.message)) {
    return "That password is too easy to guess. Use at least 8 characters, mixing letters and numbers.";
  }
  if (error.code === "over_email_send_rate_limit" || /rate limit/i.test(error.message)) {
    return "Too many emails have gone to this address in a short time. Wait a few minutes and try again.";
  }
  return `${error.message}.`;
}

/**
 * Where an account email's link returns: /auth/confirm, carrying where to go
 * after. The email templates append the one-time token to this
 * (`{{ .RedirectTo }}&token_hash=…&type=…`, supabase/templates/), and the
 * server verifies it — so the link works on any device, not only the browser
 * that asked for it. Always has a query string, which the templates rely on.
 */
export function confirmUrl(next?: string): string {
  const url = new URL("/auth/confirm", window.location.origin);
  url.searchParams.set("next", next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  return url.toString();
}

/** /auth/callback, carrying where to go after — for Google's redirect. */
export function callbackUrl(from?: string): string {
  const url = new URL("/auth/callback", window.location.origin);
  if (from) url.searchParams.set("from", from);
  return url.toString();
}

export const MIN_PASSWORD_LENGTH = 8;

/** The same rule the auth server applies (supabase/config.toml:
 *  8 characters, letters and digits), checked first so the message is ours. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) return "Use both letters and numbers.";
  return null;
}

export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters, with letters and numbers.`;
