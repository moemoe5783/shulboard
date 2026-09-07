-- Display serving: heartbeat bucketing and the rebuild-flag race.
--
-- Both of these are behaviours that look correct when exercised once and are
-- wrong under repetition, which is exactly the shape of bug a screen running for
-- months produces and a demo never does.
--
-- Run with: npm run test:db

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

begin;

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'gabbai@example.test');

select tests.authenticate_as('a1111111-1111-4111-8111-111111111111');
set local role authenticated;

insert into public.orgs (id, name, slug, timezone, created_by)
values ('0e000000-0000-4000-8000-000000000001', 'Beis Menachem', 'beis-menachem', 'UTC',
        'a1111111-1111-4111-8111-111111111111');

insert into public.screens (id, org_id, name, token)
values ('5c000000-0000-4000-8000-000000000001',
        '0e000000-0000-4000-8000-000000000001',
        'Main lobby',
        'abcdefghijkmnpqrstuvwxyz23456789');

-- The routes run as the service role, which is what these functions are granted
-- to and what bypasses RLS on a table with no insert policy.
reset role;
set local role service_role;

-- ---------------------------------------------------------------------------
-- Heartbeats accumulate within the hour.
--
-- schema.md §9: "an upsert that overwrites beat_count instead of incrementing it
-- looks correct and silently makes the whole table say 1."
-- ---------------------------------------------------------------------------

select public.record_heartbeat(
  '5c000000-0000-4000-8000-000000000001'::uuid,
  '0e000000-0000-4000-8000-000000000001'::uuid,
  p_bundle_version => 3,
  p_error_count => 0
);

do $$
declare n integer;
begin
  select beat_count into n from public.screen_heartbeats
   where screen_id = '5c000000-0000-4000-8000-000000000001';
  if n = 1 then
    perform tests.pass('heartbeat: the first beat of an hour creates the bucket with a count of 1');
  else
    perform tests.fail(format('heartbeat: expected beat_count 1, got %s', n));
  end if;
end $$;

select public.record_heartbeat(
  '5c000000-0000-4000-8000-000000000001'::uuid,
  '0e000000-0000-4000-8000-000000000001'::uuid
);
select public.record_heartbeat(
  '5c000000-0000-4000-8000-000000000001'::uuid,
  '0e000000-0000-4000-8000-000000000001'::uuid
);

do $$
declare n integer; rows integer;
begin
  select count(*) into rows from public.screen_heartbeats
   where screen_id = '5c000000-0000-4000-8000-000000000001';
  select beat_count into n from public.screen_heartbeats
   where screen_id = '5c000000-0000-4000-8000-000000000001';

  if rows <> 1 then
    perform tests.fail(format('heartbeat: three beats made %s rows, not one bucket', rows));
  elsif n = 3 then
    perform tests.pass('heartbeat: three beats in an hour increment one bucket to 3');
  else
    perform tests.fail(format('heartbeat: expected beat_count 3, got %s -- the upsert overwrites', n));
  end if;
end $$;

-- max_gap_seconds takes the maximum, so 41 beats can be told apart from a
-- 19-minute outage.
update public.screen_heartbeats
   set last_beat_at = now() - interval '400 seconds'
 where screen_id = '5c000000-0000-4000-8000-000000000001';

select public.record_heartbeat(
  '5c000000-0000-4000-8000-000000000001'::uuid,
  '0e000000-0000-4000-8000-000000000001'::uuid
);

do $$
declare gap integer;
begin
  select max_gap_seconds into gap from public.screen_heartbeats
   where screen_id = '5c000000-0000-4000-8000-000000000001';
  if gap between 395 and 405 then
    perform tests.pass('heartbeat: a silent stretch is recorded as max_gap_seconds');
  else
    perform tests.fail(format('heartbeat: expected a gap near 400s, got %s', gap));
  end if;
end $$;

-- A later, shorter gap must not lower the recorded maximum.
select public.record_heartbeat(
  '5c000000-0000-4000-8000-000000000001'::uuid,
  '0e000000-0000-4000-8000-000000000001'::uuid
);

do $$
declare gap integer;
begin
  select max_gap_seconds into gap from public.screen_heartbeats
   where screen_id = '5c000000-0000-4000-8000-000000000001';
  if gap between 395 and 405 then
    perform tests.pass('heartbeat: a later short gap does not lower the maximum');
  else
    perform tests.fail(format('heartbeat: the maximum was overwritten, now %s', gap));
  end if;
end $$;

-- error_count sums; the rest is last-write-wins.
select public.record_heartbeat(
  '5c000000-0000-4000-8000-000000000001'::uuid,
  '0e000000-0000-4000-8000-000000000001'::uuid,
  p_error_count => 2, p_last_error => 'render failed'
);
select public.record_heartbeat(
  '5c000000-0000-4000-8000-000000000001'::uuid,
  '0e000000-0000-4000-8000-000000000001'::uuid,
  p_error_count => 3, p_last_error => 'render failed again'
);

do $$
declare errs integer; last text;
begin
  select error_count, last_error into errs, last from public.screen_heartbeats
   where screen_id = '5c000000-0000-4000-8000-000000000001';
  if errs = 5 then
    perform tests.pass('heartbeat: error_count sums over the hour');
  else
    perform tests.fail(format('heartbeat: expected 5 errors, got %s', errs));
  end if;
  if last = 'render failed again' then
    perform tests.pass('heartbeat: last_error is last-write-wins');
  else
    perform tests.fail(format('heartbeat: last_error was %L', last));
  end if;
end $$;

-- The denormalised columns on screens are what the screens view reads.
do $$
declare seen timestamptz; ver integer;
begin
  select last_seen_at, last_seen_bundle_version into seen, ver
    from public.screens where id = '5c000000-0000-4000-8000-000000000001';
  if seen is not null and ver = 3 then
    perform tests.pass('heartbeat: screens.last_seen_* is updated for the screens view');
  else
    perform tests.fail(format('heartbeat: screens.last_seen_at=%L version=%s', seen, ver));
  end if;
end $$;

-- A beat carrying no bundle_version must not erase the one already reported.
do $$
declare ver integer;
begin
  select last_seen_bundle_version into ver
    from public.screens where id = '5c000000-0000-4000-8000-000000000001';
  if ver = 3 then
    perform tests.pass('heartbeat: a beat with no version keeps the last one reported');
  else
    perform tests.fail(format('heartbeat: version was overwritten with %s', ver));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The clear-the-flag race — plan.md §10.
--
-- "Capture rebuild_requested_at at the start of the build and, on success, clear
-- it only if it hasn't changed." Clearing unconditionally drops an edit made
-- during the build until the next unrelated change: a stale screen in a lobby
-- with nothing anywhere reporting an error.
-- ---------------------------------------------------------------------------

update public.screens
   set rebuild_requested_at = timestamptz '2026-01-01 00:00:00+00'
 where id = '5c000000-0000-4000-8000-000000000001';

-- Nothing edited during the build: the conditional clear matches and succeeds.
update public.screens
   set rebuild_requested_at = null
 where id = '5c000000-0000-4000-8000-000000000001'
   and rebuild_requested_at = timestamptz '2026-01-01 00:00:00+00';

do $$
declare flag timestamptz;
begin
  select rebuild_requested_at into flag from public.screens
   where id = '5c000000-0000-4000-8000-000000000001';
  if flag is null then
    perform tests.pass('rebuild race: an undisturbed build clears its own flag');
  else
    perform tests.fail(format('rebuild race: the flag survived an undisturbed build (%L)', flag));
  end if;
end $$;

-- Somebody edits content while the build is running. The flag moves; the
-- conditional clear must miss, leaving the screen queued.
update public.screens
   set rebuild_requested_at = timestamptz '2026-01-01 00:00:00+00'
 where id = '5c000000-0000-4000-8000-000000000001';

update public.screens
   set rebuild_requested_at = timestamptz '2026-01-01 00:05:00+00'
 where id = '5c000000-0000-4000-8000-000000000001';

update public.screens
   set rebuild_requested_at = null
 where id = '5c000000-0000-4000-8000-000000000001'
   and rebuild_requested_at = timestamptz '2026-01-01 00:00:00+00';

do $$
declare flag timestamptz;
begin
  select rebuild_requested_at into flag from public.screens
   where id = '5c000000-0000-4000-8000-000000000001';
  if flag = timestamptz '2026-01-01 00:05:00+00' then
    perform tests.pass('rebuild race: an edit during the build keeps the screen queued');
  else
    perform tests.fail(
      format('rebuild race: the edit was dropped -- flag is %L, the screen is now stale', flag));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Invalidation is org-wide and reaches every screen (§10).
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;

insert into public.screens (id, org_id, name, token)
values ('5c000000-0000-4000-8000-000000000002',
        '0e000000-0000-4000-8000-000000000001',
        'Beis medrash',
        'zyxwvutsrqponmkjihgfedcba98765432');

reset role;
set local role service_role;
update public.screens set rebuild_requested_at = null
 where org_id = '0e000000-0000-4000-8000-000000000001';

reset role;
set local role authenticated;
insert into public.announcements (org_id, title, body, created_by)
values ('0e000000-0000-4000-8000-000000000001', 'Kiddush', 'After davening',
        'a1111111-1111-4111-8111-111111111111');

do $$
declare flagged integer;
begin
  select count(*) into flagged from public.screens
   where org_id = '0e000000-0000-4000-8000-000000000001'
     and rebuild_requested_at is not null;
  if flagged = 2 then
    perform tests.pass('invalidation: one announcement flags every screen in the org');
  else
    perform tests.fail(format('invalidation: %s of 2 screens were flagged', flagged));
  end if;
end $$;

-- The heartbeat's own writes must NOT enqueue a rebuild, or the worker would
-- rebuild every screen every minute forever.
reset role;
set local role service_role;
update public.screens set rebuild_requested_at = null
 where org_id = '0e000000-0000-4000-8000-000000000001';

select public.record_heartbeat(
  '5c000000-0000-4000-8000-000000000001'::uuid,
  '0e000000-0000-4000-8000-000000000001'::uuid
);

do $$
declare flagged integer;
begin
  select count(*) into flagged from public.screens
   where org_id = '0e000000-0000-4000-8000-000000000001'
     and rebuild_requested_at is not null;
  if flagged = 0 then
    perform tests.pass('invalidation: a heartbeat does not enqueue a rebuild');
  else
    perform tests.fail(
      format('invalidation: a heartbeat flagged %s screens -- the worker would never idle', flagged));
  end if;
end $$;

\echo ''
select count(*) filter (where ok) as passed,
       count(*) filter (where not ok) as failed
from tests.log;

do $$
declare failed bigint;
begin
  select count(*) into failed from tests.log where not ok;
  if failed > 0 then
    raise exception '% assertion(s) failed', failed;
  end if;
end
$$;

rollback;
