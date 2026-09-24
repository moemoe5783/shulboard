/**
 * Paths that more than one module needs to agree on.
 *
 * Plain constants and no `server-only`: the proxy imports this too, and it runs
 * outside the React server.
 *
 * The sign-in path in particular was written literally in six places — the
 * proxy's public list, the proxy's redirect target, both branches of the auth
 * callback, sign out, and requireUser(). Moving the page's folder would have left
 * the proxy allowing a path that no longer exists while every redirect pointed at
 * a route that was gone: a dead-end 404, reachable only in production, with a
 * green build.
 *
 * SIGN_IN_PATH must match the location of app/(auth)/sign-in/page.tsx. Two things
 * hold it there: that page types its props as PageProps<"/sign-in">, which Next
 * generates from the file location and which stops typechecking if the folder
 * moves; and the route test follows the redirect out of a protected path and
 * asserts the destination actually serves.
 */
export const SIGN_IN_PATH = "/sign-in";

/** Where the magic link and the Google redirect both land. */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/** Creating an account with an email and password. Public. */
export const SIGN_UP_PATH = "/sign-up";

/** Asking for a password reset email. Under /sign-in so it shares its
 *  public prefix in the proxy. */
export const FORGOT_PASSWORD_PATH = "/sign-in/forgot";

/** The second step of sign-in for an account with an authenticator app. Under
 *  /sign-in for the same reason; the proxy sends an unverified session here. */
export const MFA_VERIFY_PATH = "/sign-in/verify";

/** Where the links in account emails land (confirm, reset, sign-in): verifies
 *  the email's one-time token on the server, so a link opened on a different
 *  device from the one that asked for it still works. */
export const AUTH_CONFIRM_PATH = "/auth/confirm";

/** Choosing a new password, after a reset link. */
export const NEW_PASSWORD_PATH = "/auth/new-password";

/** An invitation to join a shul — reachable signed out, so someone without an
 *  account can see who invited them before they make one. */
export const INVITE_PATH_PREFIX = "/invite/";

/** A path is safe to send someone to after sign-in: same site, not a
 *  protocol-relative `//evil.example`. */
export function safeNext(from: string | null | undefined, fallback = "/"): string {
  return from && from.startsWith("/") && !from.startsWith("//") ? from : fallback;
}
