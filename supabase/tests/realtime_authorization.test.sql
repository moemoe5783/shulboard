-- Realtime channel authorization -- can a client see screen:<id>'s broadcasts.
--
-- The policy under test does not filter realtime.messages by its own topic
-- column; it depends only on session state (the caller's JWT claim and the
-- topic the Realtime server says is being subscribed to). That is real
-- Supabase's own documented shape for this kind of policy, not a shortcut
-- taken here, but it does mean the test below has to seed at least one row
-- and then ask "is any row visible at all under these settings" rather than
-- filtering a query by topic itself.
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
values
  ('5c000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
   'Main lobby', 'abcdefghijkmnpqrstuvwxyz23456789'),
  ('5c000000-0000-4000-8000-000000000002', '0e000000-0000-4000-8000-000000000001',
   'Beis medrash', 'zyxwvutsrqponmkjihgfedcba98765432');

-- One row so the table is not empty -- the policy never reads its topic
-- column, so its content does not otherwise matter to this test.
reset role;
set local role service_role;
insert into realtime.messages (topic) values ('bundle_changed');

-- ---------------------------------------------------------------------------
-- A screen's own credential may subscribe to its own channel.
-- ---------------------------------------------------------------------------

select tests.authenticate_as_screen('5c000000-0000-4000-8000-000000000001');
select tests.set_realtime_topic('screen:5c000000-0000-4000-8000-000000000001');
set local role authenticated;

do $$
declare visible boolean;
begin
  select exists(select 1 from realtime.messages) into visible;
  if visible then
    perform tests.pass('realtime: a screen may subscribe to its own channel');
  else
    perform tests.fail('realtime: a screen was denied its own channel');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The same credential may NOT subscribe to a different screen's channel.
-- ---------------------------------------------------------------------------

select tests.set_realtime_topic('screen:5c000000-0000-4000-8000-000000000002');

do $$
declare visible boolean;
begin
  select exists(select 1 from realtime.messages) into visible;
  if visible then
    perform tests.fail('realtime: screen 1''s credential was allowed onto screen 2''s channel');
  else
    perform tests.pass('realtime: a screen may not subscribe to another screen''s channel');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A signed-in dashboard session (no screen_id claim) gets neither. Being
-- authenticated is not the same as holding a screen's Realtime credential.
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('a1111111-1111-4111-8111-111111111111');
select tests.set_realtime_topic('screen:5c000000-0000-4000-8000-000000000001');
set local role authenticated;

do $$
declare visible boolean;
begin
  select exists(select 1 from realtime.messages) into visible;
  if visible then
    perform tests.fail('realtime: a dashboard session with no screen_id claim saw a channel');
  else
    perform tests.pass('realtime: an authenticated session with no screen_id claim sees nothing');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- No policy grants anon anything, and no INSERT policy exists at all -- RLS
-- default-denies both, so even a screen's own credential cannot publish.
-- ---------------------------------------------------------------------------

select tests.authenticate_as_screen('5c000000-0000-4000-8000-000000000001');
select tests.set_realtime_topic('screen:5c000000-0000-4000-8000-000000000001');
set local role authenticated;

select tests.denied(
  $stmt$ insert into realtime.messages (topic) values ('screen:5c000000-0000-4000-8000-000000000001') $stmt$,
  'realtime: a screen''s own credential still cannot publish on its channel'
);

reset role;
set local role anon;

do $$
declare visible boolean;
begin
  select exists(select 1 from realtime.messages) into visible;
  if visible then
    perform tests.fail('realtime: the anon role saw a channel with no credential at all');
  else
    perform tests.pass('realtime: the anon role, with no credential, sees nothing');
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
