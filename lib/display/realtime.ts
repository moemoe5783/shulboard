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
 * THE KEY QUESTION, stated rather than glossed. §3a says never expose the anon
 * key to the display client, and that rule is about the BUNDLE: the bundle is
 * served by a token-validated server route holding the service role, and no
 * display request is ever authorised by RLS. Realtime is a different thing and
 * does need a key — the anon key, which is public by design and already in every
 * client bundle this app ships.
 *
 * What that costs, plainly: without an authorization policy on the channel, any
 * anonymous client can subscribe to and publish on `screen:<id>`. A forged
 * `bundle_changed` makes screens refetch, and a refetch returns 304 against an
 * unchanged ETag — so the blast radius is wasted requests, not wrong content or
 * leaked data. It still wants a Realtime authorization policy before this is
 * pointed at a real project, and that is a Supabase-side configuration this
 * repository cannot express.
 */

export type Unsubscribe = () => void;

export function subscribeToBundleChanges(screenId: string, onChange: () => void): Unsubscribe {
  // Nothing configured: the 60-second poll is the whole update path, which is
  // the same state a screen is in whenever its websocket is quietly dead.
  if (!supabaseUrl()) return () => {};

  try {
    const supabase = createClient();
    const channel = supabase.channel(`screen:${screenId}`);

    channel.on("broadcast", { event: "bundle_changed" }, () => onChange()).subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}
