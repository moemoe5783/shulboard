"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useDisplay } from "@/lib/display/useDisplay";
import { DisplayBoard, WaitingForBoard } from "./DisplayBoard";

/*
 * Which token this device runs on, and everything that follows from it.
 *
 * The stored token is read first and the URL token is the fallback, per the
 * plan's pairing-code flow (plan.md §1): a device paired once keeps working from
 * storage, so a power cut does not mean somebody retyping 32 characters into a
 * TV remote, and a future `/pair/ABC-123` entry can hand a device a token
 * without the token ever being in the address bar.
 *
 * Storage cannot enforce rotation — a device that has booted once keeps
 * presenting its old token whatever URL somebody opens on it. plan.md §3a makes
 * the bundle endpoint the compensating control, and this is the other half of
 * it: on a 410 the stored token is cleared and the device comes back as whatever
 * the URL carries.
 *
 * Nothing here reads a Supabase key. The service role key never appears anywhere
 * under app/s/.
 */

const STORAGE_KEY = "shulboard.screen.token";
const CHANGED_EVENT = "shulboard:screen-token";

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
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
  const stored = useSyncExternalStore(subscribeToStorage, readStoredToken, () => null);
  const token = stored ?? urlToken;

  const { bundle, status } = useDisplay(token);

  useEffect(() => {
    // Reads storage itself rather than trusting `stored`. During hydration that
    // value is the server's null whatever storage actually holds, and writing on
    // the strength of it would overwrite a good stored token with the URL's on
    // every boot — quietly making this URL-first, the opposite of the point.
    if (readStoredToken() !== null) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, urlToken);
      window.dispatchEvent(new Event(CHANGED_EVENT));
    } catch {
      // Storage disabled. The URL still works; the screen just cannot restore
      // itself without it.
    }
  }, [urlToken]);

  useEffect(() => {
    if (!status.tokenInvalid) return;

    // The server has retired this token. Drop it and come back as the URL — if
    // the URL carries the same dead token, the next attempt gets the same answer
    // and the screen says so rather than looping.
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event(CHANGED_EVENT));
    } catch {
      // Nothing stored to clear.
    }
  }, [status.tokenInvalid]);

  if (status.tokenInvalid && token === urlToken) {
    return (
      <WaitingForBoard reason="This screen's link was changed. Open the new link on this device." />
    );
  }

  if (!bundle) {
    return <WaitingForBoard reason="Waiting for this screen's board." />;
  }

  return (
    <>
      {/* Not on the wall. The board is the whole screen, and a token printed in
          the corner of a lobby display is both noise and a key on show. It stays
          in the markup so the boot behaviour is still checkable. */}
      <span
        className="sr-only"
        data-display-token={token}
        data-display-source={status.source}
        data-display-online={String(status.online)}
        data-display-version={bundle.bundleVersion}
        data-display-waiting-assets={String(status.waitingForAssets)}
      >
        Token {token}, bundle {bundle.bundleVersion}, from{" "}
        {status.source === "cache" ? "this device" : "the server"}
      </span>
      <DisplayBoard bundle={bundle} />
    </>
  );
}
