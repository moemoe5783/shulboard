"use client";

import { useEffect, useSyncExternalStore } from "react";

/*
 * Which token this device runs on.
 *
 * The stored token is read first and the URL token is the fallback, per the
 * plan's pairing-code flow (plan.md §1): a device paired once keeps working from
 * storage, so a power cut does not mean somebody retyping 32 characters into a
 * TV remote, and a future `/pair/ABC-123` entry can hand a device a token
 * without the token ever being in the address bar.
 *
 * KNOWN CONSEQUENCE, deliberate: because storage wins, rotating a screen's token
 * does NOT take effect on a device that has already booted once — opening the
 * new URL on it will still run the old token, which is the opposite of what
 * rotation is for. Client storage cannot enforce rotation; only the server can.
 * plan.md §3a now requires the bundle endpoint to reject a revoked or rotated
 * token, and that is the compensating control. When this route grows a bundle
 * fetch, a rejection there clears the stored token and falls back to the URL —
 * until then the precedence below is the whole story.
 *
 * Nothing here reaches the network and nothing reads a Supabase key. The service
 * role key never appears anywhere under app/s/.
 */

const STORAGE_KEY = "shulboard.screen.token";

/** Our own writes do not fire `storage` — that event is for other tabs only. */
const CHANGED_EVENT = "shulboard:screen-token";

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode, or storage switched off on the device. The URL still works;
    // the screen just cannot restore itself without it.
    return null;
  }
}

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED_EVENT, onChange);
  };
}

export function DisplayBoot({ urlToken }: { urlToken: string }) {
  // The server has no storage to read, so it renders the URL token and the
  // browser corrects it on the pass after hydration. No mismatch, and no flash
  // of a "starting" state on a screen people are standing in front of.
  const stored = useSyncExternalStore(subscribeToStorage, readStoredToken, () => null);

  useEffect(() => {
    // Reads storage itself rather than trusting `stored`. During hydration that
    // value is the server's null whatever storage actually holds, and writing on
    // the strength of it would overwrite a good stored token with the URL's on
    // every single boot — which quietly turns this into URL-first, the exact
    // opposite of what the pairing flow needs.
    if (readStoredToken() !== null) return;

    try {
      window.localStorage.setItem(STORAGE_KEY, urlToken);
      window.dispatchEvent(new Event(CHANGED_EVENT));
    } catch {
      // Same as above — not being able to remember is survivable.
    }
  }, [urlToken]);

  const token = stored ?? urlToken; // ← the precedence. Swap to make the URL win.

  return (
    <p>
      Token: {token} (from {stored ? "this device" : "the link"})
    </p>
  );
}
