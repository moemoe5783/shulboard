/**
 * The shape of a rail row.
 *
 * Its own module, not an export of NavRail: NavRail reads the pathname and is
 * therefore a client component, and every export of a client module becomes a
 * client reference that a server component cannot use as a plain string. The app
 * shell is a server component and needs this for the sign-out row.
 *
 * Anything else that belongs in the rail uses this rather than approximating it
 * with a button variant, which would put a stray accent in the navigation.
 */
export const navRowClassName =
  "text-cell rounded-control text-ink hover:bg-verdigris-wash/40 " +
  "flex h-8 w-full items-center px-2 text-left";
