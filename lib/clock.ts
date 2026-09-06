import "server-only";

import { cache } from "react";

/**
 * One clock per request.
 *
 * "Last seen 3 minutes ago" is derived from the current time, and every row on
 * a page has to be measured against the same instant — otherwise a long render
 * can put two rows a second apart for no reason a reader could explain.
 *
 * cache() makes the read happen once per request and hands back the same value
 * to everything that asks, which is also what makes it safe to call during
 * render: a component that re-renders gets the answer it got the first time.
 */
export const requestNow = cache((): number => Date.now());
