"use client";

import { createClient, supabaseUrl } from "@/lib/supabase/client";

/*
 * Realtime `bundle_changed` on channel `screen:<id>` — docs/plan.md §3d.
 *
 * A SEPARATE MODULE, LOADED ON DEMAND. The display's first paint must not wait
 * on the Supabase client, which is the largest thing this route would otherwise
 * pull; §3c says render from IndexedDB immediately, and a websocket library in
 * the boot path is the easiest way to lose that by accident.
 *
 * PRIVATE CHANNEL, AUTHORIZED PER SCREEN. `screen:<id>` is a Realtime private
 * channel: the subscribe call sets `config.private = true`, which makes the
 * server enforce the RLS policy on `realtime.messages` in
 * supabase/migrations/20260908090000_realtime_channel_authorization.sql before
 * it hands over anything. That policy reads a `screen_id` claim off the
 * caller's JWT — a claim the anon key does not carry, so subscribing needs a
 * second, purpose-built token from POST /api/screen/[token]/realtime-auth
 * (server-only, re-validates the display token). Skipping `private: true`
 * would silently make the channel public again regardless of the policy, so it
 * is not optional.
 */

export type Unsubscribe = () => void;

/** Reissued, not refreshed in place — shorter than the token's own 5-minute
 *  TTL, so a slow reconnect never finds it already expired. */
const REALTIME_AUTH_REFRESH_MS = 4 * 60 * 1000;

async function fetchRealtimeToken(screenToken: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/screen/${screenToken}/realtime-auth`, {
      method: "POST",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { token?: string };
    return body.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to bundle-change notices for one screen.
 *
 * `screenToken` is the display's own token — the same one the URL or storage
 * carries — because minting a Realtime credential re-proves ownership of the
 * screen exactly as fetching a bundle does. `screenId` is only a display
 * convenience for naming the channel; it authorizes nothing by itself.
 */
export function subscribeToBundleChanges(
  screenToken: string,
  screenId: string,
  onChange: () => void,
): Unsubscribe {
  // Nothing configured: the 60-second poll is the whole update path, which is
  // the same state a screen is in whenever its websocket is quietly dead.
  if (!supabaseUrl()) return () => {};

  let disposed = false;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  try {
    const supabase = createClient();
    const channel = supabase.channel(`screen:${screenId}`, { config: { private: true } });

    void (async () => {
      const jwt = await fetchRealtimeToken(screenToken);
      if (disposed) return;

      // No credential minted — an unknown/rotated token, or the route not yet
      // configured. Never subscribe without one: a private channel with no
      // auth set simply fails its authorization check, so this only saves a
      // round trip, but falling through to an unauthenticated subscribe is
      // exactly the hole this module exists to close.
      if (!jwt) return;

      await supabase.realtime.setAuth(jwt);
      if (disposed) return;

      channel.on("broadcast", { event: "bundle_changed" }, () => onChange()).subscribe();

      refreshTimer = setInterval(() => {
        void (async () => {
          const refreshed = await fetchRealtimeToken(screenToken);
          if (refreshed && !disposed) await supabase.realtime.setAuth(refreshed);
        })();
      }, REALTIME_AUTH_REFRESH_MS);
    })();

    return () => {
      disposed = true;
      if (refreshTimer) clearInterval(refreshTimer);
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {
      disposed = true;
    };
  }
}
