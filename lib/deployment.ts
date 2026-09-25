/*
 * Which deployment is serving this request — so a screen can tell it's
 * running code from an older one.
 *
 * A TV loads the app once and keeps it for as long as it stays on: until the
 * nightly reload (lib/display/useDisplay.ts), it runs the code it booted
 * with. A new bundle reaches it within a minute, but a board setting that a
 * newer deploy added — a caption size, a font — means nothing to the old
 * code, so the screen showed the new background and the old caption. The
 * display page carries this id, the bundle endpoint answers with it, and a
 * screen whose page is older reloads (useDisplay.ts).
 *
 * Vercel sets VERCEL_DEPLOYMENT_ID for the build and every function of a
 * deployment. Elsewhere there is nothing reliable to compare, so it's null and
 * no screen ever reloads for it.
 */

export const DEPLOYMENT_HEADER = "x-shulboard-deployment";

export function currentDeployment(): string | null {
  return process.env.VERCEL_DEPLOYMENT_ID || null;
}
