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
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
