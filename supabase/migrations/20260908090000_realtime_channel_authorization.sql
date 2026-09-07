-- Realtime channel authorization for `screen:<id>` -- docs/plan.md §3d.
--
-- lib/display/realtime.ts subscribes with the anon key, which is public and
-- identical for every screen the product serves. Without a policy here, any
-- anonymous client can subscribe to (and, absent an insert policy, still
-- cannot publish on) any screen's channel -- a forged bundle_changed only
-- costs a wasted 304, but "only" is not the same as "authorized," and this is
-- the fix.
--
-- realtime.messages is a table Supabase's own platform provides and enables
-- RLS on by default; this migration adds a policy to it, the same way an
-- application migration adds a policy to a table it owns, but never creates
-- the table or turns RLS on itself -- a real project has already done both.
--
-- The policy reads a `screen_id` claim off the caller's JWT. That JWT is not a
-- Supabase Auth session -- there is no user, no `sub` -- it is a short-lived,
-- purpose-built token minted by POST /api/screen/[token]/realtime-auth after
-- that route re-validates the screen's display token. `role: authenticated` on
-- the minted token is what makes the `to authenticated` clause below apply to
-- it; nothing else about that role is implied or granted.
--
-- No INSERT policy is added, deliberately. RLS default-denies any operation
-- with no matching policy, so a client carrying this token can receive
-- broadcasts on its own channel and cannot publish on it (or read any other
-- channel) at all -- publishing happens server-side, with the service role,
-- which bypasses RLS the same way it does everywhere else in this product.

create policy "a screen may subscribe only to its own channel"
  on realtime.messages
  for select
  to authenticated
  using (
    (auth.jwt() ->> 'screen_id') is not null
    and realtime.topic() = 'screen:' || (auth.jwt() ->> 'screen_id')
  );
