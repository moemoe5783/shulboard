-- Row-level security tests.
--
-- Two orgs, one user each. Asserts that every tenant table returns only the
-- calling user's rows, that a user cannot insert a row carrying another org's
-- org_id, and that the org_members policy does not recurse.
--
-- Run with: npm run test:db
-- Everything happens inside one transaction and is rolled back at the end.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

begin;

-- ---------------------------------------------------------------------------
-- A very small assertion harness. pgTAP is not assumed to be installed.
-- ---------------------------------------------------------------------------

create schema tests;

create table tests.log (
  id serial primary key,
  ok boolean not null,
  label text not null
);

create function tests.pass(label text) returns void language sql as $$
  insert into tests.log (ok, label) values (true, label);
$$;

create function tests.fail(label text) returns void language plpgsql as $$
begin
  insert into tests.log (ok, label) values (false, label);
  raise exception 'FAILED: %', label;
end;
$$;

create function tests.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then perform tests.pass(label); else perform tests.fail(label); end if;
end;
$$;

create function tests.eq(actual bigint, expected bigint, label text)
returns void language plpgsql as $$
begin
  if actual is not distinct from expected then
    perform tests.pass(label);
  else
    perform tests.fail(format('%s -- expected %s, got %s', label, expected, actual));
  end if;
end;
$$;

-- Asserts that a statement is rejected by RLS (42501) rather than succeeding.
create function tests.denied(stmt text, label text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception
    when insufficient_privilege then
      perform tests.pass(label);
      return;
    when others then
      perform tests.fail(format('%s -- rejected, but with %s: %s', label, sqlstate, sqlerrm));
      return;
  end;
  perform tests.fail(label || ' -- the write was ALLOWED and should not have been');
end;
$$;

-- Asserts that a statement succeeds, so that the matching denial above is not
-- passing vacuously.
create function tests.allowed(stmt text, label text) returns void
language plpgsql as $$
begin
  execute stmt;
  perform tests.pass(label);
exception when others then
  perform tests.fail(format('%s -- was rejected with %s: %s', label, sqlstate, sqlerrm));
end;
$$;

-- Every tenant table, checked the same way: exactly its own row is visible and
-- none of the other org's rows are.
create function tests.isolated(tbl text, org_col text, theirs uuid) returns void
language plpgsql as $$
declare
  total bigint;
  leaked bigint;
begin
  execute format('select count(*) from %s', tbl) into total;
  execute format('select count(*) from %s where %I = $1', tbl, org_col)
    using theirs into leaked;

  perform tests.eq(total, 1::bigint, tbl || ': sees exactly its own row');
  perform tests.eq(leaked, 0::bigint, tbl || ': sees none of the other org''s rows');
end;
$$;

create function tests.authenticate_as(uid uuid) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
$$;

grant usage on schema tests to authenticated;
grant insert, select on tests.log to authenticated;
grant usage, select on sequence tests.log_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Seed, as postgres. Two orgs, one user each, one row per tenant table per org.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'gabbai-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'gabbai-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'newcomer@example.test');

-- The orgs trigger makes each creator the owner of their own org.
insert into public.orgs (id, name, slug, created_by) values
  ('0a000000-0000-4000-8000-000000000001', 'Beis Menachem', 'beis-menachem',
   '11111111-1111-4111-8111-111111111111'),
  ('0b000000-0000-4000-8000-000000000001', 'Ohel Moshe', 'ohel-moshe',
   '22222222-2222-4222-8222-222222222222');

insert into public.org_invites (org_id, email, token, expires_at) values
  ('0a000000-0000-4000-8000-000000000001', 'invitee-a@example.test', 'token-a', now() + interval '7 days'),
  ('0b000000-0000-4000-8000-000000000001', 'invitee-b@example.test', 'token-b', now() + interval '7 days');

insert into public.boards (id, org_id, name) values
  ('0a000000-0000-4000-8000-0000000000b0', '0a000000-0000-4000-8000-000000000001', 'Weekday board'),
  ('0b000000-0000-4000-8000-0000000000b0', '0b000000-0000-4000-8000-000000000001', 'Weekday board');

insert into public.playlists (id, org_id, name) values
  ('0a000000-0000-4000-8000-0000000000c0', '0a000000-0000-4000-8000-000000000001', 'Weekdays'),
  ('0b000000-0000-4000-8000-0000000000c0', '0b000000-0000-4000-8000-000000000001', 'Weekdays');

insert into public.playlist_items (org_id, playlist_id, board_id, position) values
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000c0',
   '0a000000-0000-4000-8000-0000000000b0', 1),
  ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-0000000000c0',
   '0b000000-0000-4000-8000-0000000000b0', 1);

insert into public.screens (id, org_id, name, token, playlist_id) values
  ('0a000000-0000-4000-8000-0000000000d0', '0a000000-0000-4000-8000-000000000001',
   'Main lobby', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0a000000-0000-4000-8000-0000000000c0'),
  ('0b000000-0000-4000-8000-0000000000d0', '0b000000-0000-4000-8000-000000000001',
   'Main lobby', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '0b000000-0000-4000-8000-0000000000c0');

insert into public.assets (id, org_id, kind, storage_path, mime_type) values
  ('0a000000-0000-4000-8000-0000000000e0', '0a000000-0000-4000-8000-000000000001',
   'image', '0a000000-0000-4000-8000-000000000001/e0/original.jpg', 'image/jpeg'),
  ('0b000000-0000-4000-8000-0000000000e0', '0b000000-0000-4000-8000-000000000001',
   'image', '0b000000-0000-4000-8000-000000000001/e0/original.jpg', 'image/jpeg');

insert into public.albums (id, org_id, name) values
  ('0a000000-0000-4000-8000-0000000000f0', '0a000000-0000-4000-8000-000000000001', 'Kiddush photos'),
  ('0b000000-0000-4000-8000-0000000000f0', '0b000000-0000-4000-8000-000000000001', 'Kiddush photos');

insert into public.album_items (org_id, album_id, asset_id, position) values
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000f0',
   '0a000000-0000-4000-8000-0000000000e0', 1),
  ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-0000000000f0',
   '0b000000-0000-4000-8000-0000000000e0', 1);

insert into public.people (org_id, display_name, death_hebrew_year, death_hebrew_month, death_hebrew_day) values
  ('0a000000-0000-4000-8000-000000000001', 'R'' Yosef Cohen', 5780, 'elul', 23),
  ('0b000000-0000-4000-8000-000000000001', 'R'' Dovid Levi', 5781, 'kislev', 12);

insert into public.announcements (org_id, title) values
  ('0a000000-0000-4000-8000-000000000001', 'Shiur moved to the beis medrash'),
  ('0b000000-0000-4000-8000-000000000001', 'Kiddush this Shabbos');

insert into public.schedules (org_id, kind, label, time_kind, fixed_time) values
  ('0a000000-0000-4000-8000-000000000001', 'davening', 'Shacharis', 'fixed', '07:00'),
  ('0b000000-0000-4000-8000-000000000001', 'davening', 'Shacharis', 'fixed', '07:15');

insert into public.calendar_connections (id, org_id, calendar_id) values
  ('0a000000-0000-4000-8000-000000000aa0', '0a000000-0000-4000-8000-000000000001', 'cal-a@group.calendar.google.com'),
  ('0b000000-0000-4000-8000-000000000aa0', '0b000000-0000-4000-8000-000000000001', 'cal-b@group.calendar.google.com');

insert into public.calendar_events (org_id, connection_id, external_id, title, starts_at, ends_at) values
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000aa0',
   'evt-a', 'Shiur', now(), now() + interval '1 hour'),
  ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000aa0',
   'evt-b', 'Shiur', now(), now() + interval '1 hour');

insert into public.screen_bundles (screen_id, org_id, content_hash, payload, byte_size) values
  ('0a000000-0000-4000-8000-0000000000d0', '0a000000-0000-4000-8000-000000000001', 'hash-a', '{}', 2),
  ('0b000000-0000-4000-8000-0000000000d0', '0b000000-0000-4000-8000-000000000001', 'hash-b', '{}', 2);

insert into public.screen_heartbeats (screen_id, bucket_hour, org_id, beat_count) values
  ('0a000000-0000-4000-8000-0000000000d0', date_trunc('hour', now()),
   '0a000000-0000-4000-8000-000000000001', 60),
  ('0b000000-0000-4000-8000-0000000000d0', date_trunc('hour', now()),
   '0b000000-0000-4000-8000-000000000001', 60);

insert into public.audit_log (org_id, action, entity_table) values
  ('0a000000-0000-4000-8000-000000000001', 'update', 'announcements'),
  ('0b000000-0000-4000-8000-000000000001', 'update', 'announcements');

-- Shared across orgs, deliberately. Both users must see this same row.
insert into public.zmanim_cache (provider, location_id, date, timezone, times) values
  ('hebcal', 'geo:40.669,-73.943', current_date, 'America/New_York',
   '{"shkia": {"iso": "2026-09-04T19:22:00-04:00", "display": "7:22 pm"}}');

-- ---------------------------------------------------------------------------
-- Tenant isolation, from each user in turn.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('11111111-1111-4111-8111-111111111111');
set local role authenticated;

-- THIS RUNS FIRST, before anything else touches org_members, because when it
-- fails it explains every other failure in the file.
--
-- The org_members policies call is_org_member(), and is_org_member() reads
-- org_members. SECURITY DEFINER on the helper is what breaks that loop. Without
-- it the read is itself subject to the policy that called it, and the query dies
-- -- as 42P17 "infinite recursion detected in policy" when Postgres spots the
-- cycle, or as 54001 "stack depth limit exceeded" when the recursion runs through
-- a SQL function and it does not. Either way it fails at QUERY time, not at
-- definition time, so the change that caused it passed review and deployed
-- cleanly.
do $$
declare n bigint;
begin
  select count(*) into n from public.org_members;
  perform tests.eq(n, 1::bigint, 'org_members: the policy resolves without recursing');
exception when others then
  if sqlstate in ('42P17', '54001') then
    perform tests.fail(format(
      'org_members: POLICY RECURSION (%s) -- is_org_member() has lost SECURITY DEFINER',
      sqlstate));
  else
    raise;
  end if;
end
$$;

do $$
declare
  theirs uuid := '0b000000-0000-4000-8000-000000000001';
  t text;
begin
  -- orgs is keyed on its own id; every other tenant table carries org_id.
  perform tests.isolated('public.orgs', 'id', theirs);

  foreach t in array array[
    'public.org_members', 'public.org_invites', 'public.boards',
    'public.playlists', 'public.playlist_items', 'public.screens',
    'public.assets', 'public.albums', 'public.album_items',
    'public.people', 'public.announcements', 'public.schedules',
    'public.calendar_connections', 'public.calendar_events',
    'public.screen_bundles', 'public.screen_heartbeats', 'public.audit_log'
  ] loop
    perform tests.isolated(t, 'org_id', theirs);
  end loop;
end
$$;

-- The same recursion, reached through the helper functions directly.
do $$
begin
  perform tests.ok(
    public.is_org_member('0a000000-0000-4000-8000-000000000001'),
    'is_org_member: true for the caller''s own org');
  perform tests.ok(
    not public.is_org_member('0b000000-0000-4000-8000-000000000001'),
    'is_org_member: false for another org');
  perform tests.ok(
    public.has_org_role_at_least('0a000000-0000-4000-8000-000000000001', 'owner'),
    'has_org_role_at_least: an owner satisfies owner');
  perform tests.ok(
    public.has_org_role_at_least('0a000000-0000-4000-8000-000000000001', 'editor'),
    'has_org_role_at_least: an owner satisfies editor (it ranks, it does not match)');
  perform tests.ok(
    not public.has_org_role_at_least('0b000000-0000-4000-8000-000000000001', 'viewer'),
    'has_org_role_at_least: false for another org');
end
$$;

-- An unrecognised role must raise, not quietly return false. Returning false
-- would silently lock people out of their own data.
do $$
begin
  begin
    perform public.has_org_role_at_least('0a000000-0000-4000-8000-000000000001', 'Editor');
  exception when others then
    perform tests.pass('has_org_role_at_least: an unknown role raises rather than returning false');
    return;
  end;
  perform tests.fail('has_org_role_at_least: an unknown role returned instead of raising');
end
$$;

reset role;

select tests.authenticate_as('22222222-2222-4222-8222-222222222222');
set local role authenticated;

do $$
declare
  theirs uuid := '0a000000-0000-4000-8000-000000000001';
  t text;
begin
  perform tests.isolated('public.orgs', 'id', theirs);

  foreach t in array array[
    'public.org_members', 'public.org_invites', 'public.boards',
    'public.playlists', 'public.playlist_items', 'public.screens',
    'public.assets', 'public.albums', 'public.album_items',
    'public.people', 'public.announcements', 'public.schedules',
    'public.calendar_connections', 'public.calendar_events',
    'public.screen_bundles', 'public.screen_heartbeats', 'public.audit_log'
  ] loop
    perform tests.isolated(t, 'org_id', theirs);
  end loop;
end
$$;

-- zmanim_cache is the control: it is shared on purpose and has no org_id, so
-- both users see the same row. If this ever returns 0 someone has "fixed" it.
do $$
declare n bigint;
begin
  select count(*) into n from public.zmanim_cache;
  perform tests.eq(n, 1::bigint, 'zmanim_cache: shared across orgs, visible to every member');
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Cross-org writes. Every one of these must be rejected.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('11111111-1111-4111-8111-111111111111');
set local role authenticated;

do $$
declare
  mine uuid := '0a000000-0000-4000-8000-000000000001';
  theirs uuid := '0b000000-0000-4000-8000-000000000001';
begin
  -- Each pair is the same insert twice: once into the caller's own org, which
  -- must succeed, and once into the other org, which must not. Without the
  -- succeeding half the denial could be passing for an unrelated reason.

  perform tests.allowed(
    format('insert into public.boards (org_id, name) values (%L, %L)', mine, 'Shabbos board'),
    'boards: insert into own org');
  perform tests.denied(
    format('insert into public.boards (org_id, name) values (%L, %L)', theirs, 'Hijacked board'),
    'boards: insert carrying another org''s org_id');

  perform tests.allowed(
    format('insert into public.playlists (org_id, name) values (%L, %L)', mine, 'Shabbos'),
    'playlists: insert into own org');
  perform tests.denied(
    format('insert into public.playlists (org_id, name) values (%L, %L)', theirs, 'Hijacked'),
    'playlists: insert carrying another org''s org_id');

  perform tests.denied(
    format($f$insert into public.playlist_items (org_id, playlist_id, board_id, position)
              values (%L, '0b000000-0000-4000-8000-0000000000c0',
                      '0b000000-0000-4000-8000-0000000000b0', 99)$f$, theirs),
    'playlist_items: insert carrying another org''s org_id');

  perform tests.allowed(
    format('insert into public.screens (org_id, name, token) values (%L, %L, %L)',
           mine, 'Beis medrash', 'cccccccccccccccccccccccccccccccc'),
    'screens: insert into own org');
  perform tests.denied(
    format('insert into public.screens (org_id, name, token) values (%L, %L, %L)',
           theirs, 'Hijacked screen', 'dddddddddddddddddddddddddddddddd'),
    'screens: insert carrying another org''s org_id');

  perform tests.allowed(
    format($f$insert into public.assets (org_id, kind, storage_path, mime_type)
              values (%L, 'image', 'a/2/original.jpg', 'image/jpeg')$f$, mine),
    'assets: insert into own org');
  perform tests.denied(
    format($f$insert into public.assets (org_id, kind, storage_path, mime_type)
              values (%L, 'image', 'b/2/original.jpg', 'image/jpeg')$f$, theirs),
    'assets: insert carrying another org''s org_id');

  perform tests.allowed(
    format('insert into public.albums (org_id, name) values (%L, %L)', mine, 'Purim'),
    'albums: insert into own org');
  perform tests.denied(
    format('insert into public.albums (org_id, name) values (%L, %L)', theirs, 'Hijacked album'),
    'albums: insert carrying another org''s org_id');

  perform tests.denied(
    format($f$insert into public.album_items (org_id, album_id, asset_id, position)
              values (%L, '0b000000-0000-4000-8000-0000000000f0',
                      '0b000000-0000-4000-8000-0000000000e0', 99)$f$, theirs),
    'album_items: insert carrying another org''s org_id');

  perform tests.allowed(
    format($f$insert into public.people (org_id, display_name, birth_date_gregorian)
              values (%L, 'Chaim Stern', '1960-04-01')$f$, mine),
    'people: insert into own org');
  perform tests.denied(
    format($f$insert into public.people (org_id, display_name, birth_date_gregorian)
              values (%L, 'Hijacked person', '1960-04-01')$f$, theirs),
    'people: insert carrying another org''s org_id');

  perform tests.allowed(
    format('insert into public.announcements (org_id, title) values (%L, %L)', mine, 'Eruv is up'),
    'announcements: insert into own org');
  perform tests.denied(
    format('insert into public.announcements (org_id, title) values (%L, %L)', theirs, 'Hijacked notice'),
    'announcements: insert carrying another org''s org_id');

  perform tests.allowed(
    format($f$insert into public.schedules (org_id, kind, label, time_kind, fixed_time)
              values (%L, 'shiur', 'Daf yomi', 'fixed', '20:00')$f$, mine),
    'schedules: insert into own org');
  perform tests.denied(
    format($f$insert into public.schedules (org_id, kind, label, time_kind, fixed_time)
              values (%L, 'shiur', 'Hijacked shiur', 'fixed', '20:00')$f$, theirs),
    'schedules: insert carrying another org''s org_id');

  perform tests.allowed(
    format($f$insert into public.org_invites (org_id, email, token, expires_at)
              values (%L, 'newcomer@example.test', 'token-a2', now() + interval '7 days')$f$, mine),
    'org_invites: insert into own org');
  perform tests.denied(
    format($f$insert into public.org_invites (org_id, email, token, expires_at)
              values (%L, 'attacker@example.test', 'token-b2', now() + interval '7 days')$f$, theirs),
    'org_invites: insert carrying another org''s org_id');

  perform tests.allowed(
    format($f$insert into public.org_members (org_id, user_id, role)
              values (%L, '33333333-3333-4333-8333-333333333333', 'editor')$f$, mine),
    'org_members: insert into own org');
  perform tests.denied(
    format($f$insert into public.org_members (org_id, user_id, role)
              values (%L, '11111111-1111-4111-8111-111111111111', 'admin')$f$, theirs),
    'org_members: insert carrying another org''s org_id');

  perform tests.allowed(
    format($f$insert into public.calendar_connections (org_id, calendar_id)
              values (%L, 'cal-a2@group.calendar.google.com')$f$, mine),
    'calendar_connections: insert into own org');
  perform tests.denied(
    format($f$insert into public.calendar_connections (org_id, calendar_id)
              values (%L, 'cal-b2@group.calendar.google.com')$f$, theirs),
    'calendar_connections: insert carrying another org''s org_id');

  -- An org may be created by anyone, but only in their own name.
  perform tests.denied(
    $f$insert into public.orgs (name, slug, created_by)
       values ('Impersonated', 'impersonated', '22222222-2222-4222-8222-222222222222')$f$,
    'orgs: insert claiming another user as the creator');
end
$$;

-- These five tables have no insert policy at all, by design: they are written
-- only by server-only code holding the service role. A client must be refused
-- even for its OWN org.
do $$
declare
  mine uuid := '0a000000-0000-4000-8000-000000000001';
  theirs uuid := '0b000000-0000-4000-8000-000000000001';
begin
  perform tests.denied(
    format($f$insert into public.calendar_events (org_id, connection_id, external_id, title, starts_at, ends_at)
              values (%L, '0a000000-0000-4000-8000-000000000aa0', 'evt-a2', 'Forged',
                      now(), now() + interval '1 hour')$f$, mine),
    'calendar_events: no client insert, even into the caller''s own org');
  perform tests.denied(
    format($f$insert into public.calendar_events (org_id, connection_id, external_id, title, starts_at, ends_at)
              values (%L, '0b000000-0000-4000-8000-000000000aa0', 'evt-b2', 'Forged',
                      now(), now() + interval '1 hour')$f$, theirs),
    'calendar_events: insert carrying another org''s org_id');

  perform tests.denied(
    format($f$insert into public.screen_bundles (screen_id, org_id, content_hash, payload, byte_size)
              values ('0b000000-0000-4000-8000-0000000000d0', %L, 'forged', '{}', 2)$f$, theirs),
    'screen_bundles: insert carrying another org''s org_id');

  perform tests.denied(
    format($f$insert into public.screen_heartbeats (screen_id, bucket_hour, org_id, beat_count)
              values ('0b000000-0000-4000-8000-0000000000d0',
                      date_trunc('hour', now() - interval '1 hour'), %L, 60)$f$, theirs),
    'screen_heartbeats: no client insert -- forging liveness for another org''s screen');

  perform tests.denied(
    format($f$insert into public.audit_log (org_id, action, entity_table)
              values (%L, 'forged', 'announcements')$f$, mine),
    'audit_log: no client insert, even into the caller''s own org');
  perform tests.denied(
    format($f$insert into public.audit_log (org_id, action, entity_table)
              values (%L, 'forged', 'announcements')$f$, theirs),
    'audit_log: insert carrying another org''s org_id');

  perform tests.denied(
    $f$insert into public.zmanim_cache (provider, location_id, date, timezone, times)
       values ('hebcal', 'geo:0,0', current_date, 'UTC', '{}')$f$,
    'zmanim_cache: shared and read-only to clients');
end
$$;

-- An update cannot move a row into another org either: the with check clause on
-- every write policy re-asserts membership against the NEW org_id.
do $$
declare
  moved bigint;
begin
  update public.boards
     set org_id = '0b000000-0000-4000-8000-000000000001'
   where org_id = '0a000000-0000-4000-8000-000000000001';
  get diagnostics moved = row_count;
  perform tests.fail(format(
    'boards: an update moved %s row(s) into another org', moved));
exception when insufficient_privilege then
  perform tests.pass('boards: update cannot move a row into another org');
end
$$;

-- The membership guard trigger: an admin must not be able to promote themselves.
reset role;
insert into public.org_members (org_id, user_id, role) values
  ('0b000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'admin');

select tests.authenticate_as('33333333-3333-4333-8333-333333333333');
set local role authenticated;

do $$
begin
  begin
    update public.org_members set role = 'owner'
     where org_id = '0b000000-0000-4000-8000-000000000001'
       and user_id = '33333333-3333-4333-8333-333333333333';
  exception when others then
    perform tests.pass('org_members: an admin cannot promote themselves to owner');
    return;
  end;
  perform tests.fail('org_members: an admin PROMOTED THEMSELVES to owner');
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Summary
-- ---------------------------------------------------------------------------

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
  raise notice 'all % RLS assertions passed', (select count(*) from tests.log);
end
$$;

rollback;
