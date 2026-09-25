"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useDisplay } from "@/lib/display/useDisplay";
import { useFontsReady } from "@/lib/display/fonts";
import { DebugView } from "./DebugView";
import { DisplayBoard, LoadingProgress, UpdatingBadge, WaitingForBoard } from "./DisplayBoard";

/*
 * Which token this device runs on, and everything that follows from it.
 *
 * The stored token is read first and the URL token is the fallback, per the
 * plan's pairing-code flow (plan.md §1): a device paired once keeps working from
 * storage, so a power cut does not mean somebody retyping 32 characters into a
 * TV remote, and /pair hands a device a token without the token ever being
 * in the address bar.
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

/** How long the loading screen may stay over a first board waiting for its
 *  opening photos — past this the board shows what it has. */
const OPENING_PAGES_MAX_MS = 60_000;
/** A board whose widgets haven't declared any photos by now has none to wait for. */
const OPENING_PAGES_MIN_MS = 1_500;
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

export function DisplayBoot({ urlToken, deployment = null }: { urlToken: string; deployment?: string | null }) {
  const stored = useSyncExternalStore(subscribeToStorage, readStoredToken, () => null);
  const token = stored ?? urlToken;

  const { bundle, status, files, filesSnapshot, storage } = useDisplay(token, deployment);

  // Album photos the board's galleries and collages are waiting on. Read off
  // the snapshot so this re-renders as they land.
  const photos = files.wantedProgress();
  // The board's fonts, loaded before it's seen (lib/display/fonts.ts): on a
  // boot from this device's copy the board is drawn under the loading screen
  // until they are; a board that arrived from the network loaded them first.
  const fontsReady = useFontsReady(bundle?.fonts);
  const head = files.headProgress();

  // The first board of this boot stays under the loading screen until its
  // galleries' and collages' opening pages are here — drawn underneath, so
  // they can measure themselves and say what they need. Once it's up, later
  // downloads only ever show the small tag.
  const [boardUpAt, setBoardUpAt] = useState<number | null>(null);
  const [openingDone, setOpeningDone] = useState(false);
  // Only a board with a gallery or collage has opening photos to wait for.
  const hasAlbums = Boolean(
    bundle?.boards.some((board) =>
      (board.doc.widgets ?? []).some((widget) => {
        const config = widget.config as Record<string, unknown> | null;
        return Boolean(config && ("albumIds" in config || "albumId" in config || "albumMode" in config));
      }),
    ),
  );
  useEffect(() => {
    if (bundle && boardUpAt === null) {
      const mark = setTimeout(() => setBoardUpAt(Date.now()), 0);
      return () => clearTimeout(mark);
    }
  }, [bundle, boardUpAt]);
  useEffect(() => {
    if (openingDone || boardUpAt === null) return;
    const check = () => {
      if (!hasAlbums) return setOpeningDone(true);
      const elapsed = Date.now() - boardUpAt;
      const progress = files.headProgress();
      if ((progress.total > 0 && progress.done >= progress.total) || (progress.total === 0 && elapsed > OPENING_PAGES_MIN_MS) || elapsed > OPENING_PAGES_MAX_MS) {
        setOpeningDone(true);
      }
    };
    check();
    const timer = setInterval(check, 250);
    return () => clearInterval(timer);
  }, [openingDone, boardUpAt, hasAlbums, files, filesSnapshot]);

  // An update, or the rest of this board's photos, downloading behind a board
  // that's showing: say so only once it has taken a few seconds.
  const boardUpdate = Boolean(bundle && status.assetProgress && status.assetProgress.done < status.assetProgress.total);
  const photosArriving = Boolean(bundle && openingDone && photos.done < photos.total);
  const updating = boardUpdate || photosArriving;
  const [slowUpdate, setSlowUpdate] = useState(false);
  useEffect(() => {
    if (!updating) {
      const reset = setTimeout(() => setSlowUpdate(false), 0);
      return () => clearTimeout(reset);
    }
    const timer = setTimeout(() => setSlowUpdate(true), 3000);
    return () => clearTimeout(timer);
  }, [updating]);

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

  // The link is dead for this device — disconnected in the dashboard, rotated,
  // the screen deleted, or it now belongs to another TV. Go and show a pairing
  // code, so connecting it again is a code on the TV rather than a new link
  // typed with a remote.
  const retired = status.tokenInvalid && token === urlToken;
  useEffect(() => {
    if (!retired) return;
    window.location.replace(`/pair?reason=${status.otherDevice ? "other-tv" : "disconnected"}`);
  }, [retired, status.otherDevice]);

  if (retired) {
    return (
      <WaitingForBoard
        reason={
          status.otherDevice
            ? "This screen is connected to a different TV."
            : "This screen was disconnected. Showing a code to connect it again."
        }
      />
    );
  }

  if (!bundle) {
    if (status.assetProgress && status.assetProgress.total > 0) {
      return <LoadingProgress done={status.assetProgress.done} total={status.assetProgress.total} />;
    }
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
        data-display-fonts-ready={String(fontsReady)}
      >
        Token {token}, bundle {bundle.bundleVersion}, from{" "}
        {status.source === "cache" ? "this device" : "the server"}
      </span>
      <DisplayBoard bundle={bundle} files={filesSnapshot} />
      {/* From the first frame, so the board is never seen without its photos. */}
      {!openingDone && hasAlbums && <LoadingProgress done={head.done} total={head.total} over />}
      {!fontsReady && (openingDone || !hasAlbums) && <LoadingProgress done={0} total={1} over />}
      {updating && slowUpdate && (
        <UpdatingBadge
          done={boardUpdate ? status.assetProgress!.done : photos.done}
          total={boardUpdate ? status.assetProgress!.total : photos.total}
          label={boardUpdate ? "Updating board" : "Loading"}
        />
      )}
      <DebugView files={files} snapshot={filesSnapshot} storage={storage} bundleVersion={bundle.bundleVersion} />
    </>
  );
}
