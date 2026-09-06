import "server-only";

import { headers } from "next/headers";

/**
 * The origin the gabbai is actually looking at.
 *
 * A display link gets typed into a TV remote, so it has to be the host they
 * know rather than a build-time guess: the same screen opened from a preview
 * deployment and from the real domain must hand out the link that matches.
 * Vercel sets x-forwarded-proto; local dev doesn't, and there http is right.
 */
export async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
