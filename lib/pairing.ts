/*
 * The pieces of TV pairing both ends agree on (supabase/migrations/
 * 20260925090200_screen_pairing.sql): the header a TV proves itself with, the
 * shape of its secret, and how a secret becomes the hash the server keeps.
 * Pure and dependency-free, so the display (a browser), the server routes and
 * the tests all use this one copy.
 */

/** The header every display request carries its device secret in. */
export const DEVICE_HEADER = "x-screen-device";

/** 32 random bytes, base64url: 43 characters. Anything else isn't a secret we made. */
export function isDeviceSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** How long a pairing code is good for. */
export const PAIRING_MINUTES = 10;

/** "482915" -> "482 915", the way the TV shows it. */
export function formatPairingCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** A short name for the device from its user agent, for "Connected: Samsung TV". */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/Tizen/i.test(ua)) return "Samsung TV";
  if (/Web0S|webOS/i.test(ua)) return "LG TV";
  if (/CrKey/i.test(ua)) return "Chromecast";
  if (/AFT[A-Z]/.test(ua)) return "Fire TV";
  if (/BRAVIA|Android TV|GoogleTV/i.test(ua)) return "Android TV";
  if (/Roku/i.test(ua)) return "Roku";
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android device";
  if (/Windows/i.test(ua)) return "Windows computer";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/CrOS/i.test(ua)) return "Chromebook";
  if (/Linux/i.test(ua)) return "Linux computer";
  return "Browser";
}
