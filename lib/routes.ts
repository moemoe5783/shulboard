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
