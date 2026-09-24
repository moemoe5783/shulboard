import { DEVICE_HEADER } from "../pairing";

/*
 * This device's secret — what makes it THE TV of a screen (one TV per screen,
 * supabase/migrations/20260925090200_screen_pairing.sql). Made once, the first
 * time a display or the /pair page runs here, and kept in storage for good:
 * 32 random bytes, sent with every screen request (DEVICE_HEADER), never shown.
 *
 * If storage is unavailable (a private window, a locked-down browser) the
 * secret lives for this page load only; the screen still works, but a reload
 * is a new device, which a bound screen will refuse — the same as any other TV.
 */

const STORAGE_KEY = "shulboard.screen.device";
let memory: string | null = null;

function makeSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deviceSecret(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && /^[A-Za-z0-9_-]{43}$/.test(stored)) return stored;
    const fresh = memory ?? makeSecret();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    memory = fresh;
    return fresh;
  } catch {
    memory ??= makeSecret();
    return memory;
  }
}

/** Headers for a screen request, with this device's secret. */
export function deviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, [DEVICE_HEADER]: deviceSecret() };
}
