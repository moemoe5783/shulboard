import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/*
 * Next 16 renamed the `middleware` file convention to `proxy`. Same request
 * interception, same matcher, different filename and export name.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets and static files. The display route is
     * deliberately NOT excluded here — it runs through the proxy and is allowed
     * by the public-prefix list, so that allowance is written down in one place
     * rather than split between a regex and a list.
     *
     * /fonts/ is skipped outright, like Next's own static files: the board
     * font catalog's woff2 files and its generated stylesheet
     * (scripts/build-fonts.ts), public and immutable. Without this the
     * stylesheet (.css isn't in the extension list) was answered with the
     * sign-in redirect and declared no faces at all.
     */
    "/((?!_next/static|_next/image|fonts/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
