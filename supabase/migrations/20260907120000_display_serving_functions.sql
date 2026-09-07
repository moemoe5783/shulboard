-- The two writes the display's server routes make, as SQL functions.
--
-- Both exist because PostgREST cannot express `column = column + 1`. An upsert
-- written through the REST client OVERWRITES beat_count instead of incrementing
-- it, which looks correct in every test that beats once and silently makes the
-- whole table say 1 -- see docs/schema.md §9, which calls this out by name.
--
-- SECURITY INVOKER, deliberately. These are called by the service role, which
-- already bypasses RLS; making them definer would mean any role granted execute
-- could forge a heartbeat for any screen in any org. Execute is revoked from
-- everyone and granted only to service_role.

-- One row per screen per hour. beat_count and error_count ACCUMULATE,
-- max_gap_seconds takes the MAXIMUM, everything else is last-write-wins.
create function public.record_heartbeat(
  p_screen_id uuid,
  p_org_id uuid,
  p_bundle_version integer default null,
  p_board_id uuid default null,
  p_app_version text default null,
  p_user_agent text default null,
  p_viewport_width integer default null,
  p_viewport_height integer default null,
  p_uptime_seconds integer default null,
  p_error_count integer default 0,
  p_last_error text default null
)
returns void
language sql
set search_path = ''
as $$
  with beat as (
    insert into public.screen_heartbeats as h (
      screen_id, bucket_hour, org_id,
      beat_count, first_beat_at, last_beat_at, max_gap_seconds,
      bundle_version, board_id, app_version, user_agent,
      viewport_width, viewport_height, uptime_seconds,
      error_count, last_error
    )
    values (
      p_screen_id, date_trunc('hour', now()), p_org_id,
      1, now(), now(), null,
      p_bundle_version, p_board_id, p_app_version, p_user_agent,
      p_viewport_width, p_viewport_height, p_uptime_seconds,
      coalesce(p_error_count, 0), p_last_error
    )
    on conflict (screen_id, bucket_hour) do update set
      beat_count = h.beat_count + 1,
      last_beat_at = now(),
      -- The one thing naive bucketing would destroy: 41 beats in an hour could
      -- be a single 19-minute outage or 19 scattered misses, and those are
      -- different support calls.
      max_gap_seconds = greatest(
        coalesce(h.max_gap_seconds, 0),
        floor(extract(epoch from (now() - h.last_beat_at)))::integer
      ),
      bundle_version = coalesce(excluded.bundle_version, h.bundle_version),
      board_id = coalesce(excluded.board_id, h.board_id),
      app_version = coalesce(excluded.app_version, h.app_version),
      user_agent = coalesce(excluded.user_agent, h.user_agent),
      viewport_width = coalesce(excluded.viewport_width, h.viewport_width),
      viewport_height = coalesce(excluded.viewport_height, h.viewport_height),
      uptime_seconds = coalesce(excluded.uptime_seconds, h.uptime_seconds),
      error_count = h.error_count + coalesce(excluded.error_count, 0),
      last_error = coalesce(excluded.last_error, h.last_error),
      updated_at = now()
    returning 1
  )
  -- The denormalised columns on screens are the read path for the screens view
  -- (design.md §4), which renders from one indexed scan and never joins this
  -- history table. None of these columns is in the rebuild trigger's WHEN
  -- clause, so this write does not enqueue a rebuild.
  update public.screens s
     set last_seen_at = now(),
         last_seen_bundle_version = coalesce(p_bundle_version, s.last_seen_bundle_version),
         last_seen_board_id = coalesce(p_board_id, s.last_seen_board_id)
   where s.id = p_screen_id
     and exists (select 1 from beat);
$$;

-- A build that could not finish. The flag stays set so the worker tries again,
-- the attempt is counted so back-off has something to count, and the previous
-- bundle keeps serving throughout -- schema.md §9.
create function public.record_bundle_build_failure(
  p_screen_id uuid,
  p_error text
)
returns void
language sql
set search_path = ''
as $$
  update public.screens
     set rebuild_attempts = rebuild_attempts + 1,
         rebuild_last_error = left(p_error, 2000),
         rebuild_last_attempt_at = now()
   where id = p_screen_id;
$$;

revoke all on function public.record_heartbeat(
  uuid, uuid, integer, uuid, text, text, integer, integer, integer, integer, text
) from public, anon, authenticated;
revoke all on function public.record_bundle_build_failure(uuid, text)
  from public, anon, authenticated;

grant execute on function public.record_heartbeat(
  uuid, uuid, integer, uuid, text, text, integer, integer, integer, integer, text
) to service_role;
grant execute on function public.record_bundle_build_failure(uuid, text) to service_role;
