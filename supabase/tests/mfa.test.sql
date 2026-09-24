-- Two-step sign-in, enforced in the database (20260925090100).
--
-- An account with a verified authenticator app sees nothing and writes nothing
-- on a password-only (aal1) session; the same account at aal2 does; an account
-- without one is unaffected. And every RLS table in public carries the
-- restrictive policy, so a new table can't quietly skip it.
--
-- Run with: npm run test:db. Rolled back at the end.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

begin;
\o /dev/null

insert into auth.users (id, email) values
  ('b1111111-1111-4111-8111-111111111111', 'careful@example.test'),
  ('b2222222-2222-4222-8222-222222222222', 'relaxed@example.test');

insert into public.orgs (id, name, slug, created_by) values
  ('0d000000-0000-4000-8000-000000000001', 'Ohel Yosef', 'ohel-yosef-mfa', 'b1111111-1111-4111-8111-111111111111');
insert into public.org_members (org_id, user_id, role) values
  ('0d000000-0000-4000-8000-000000000001', 'b2222222-2222-4222-8222-222222222222', 'admin');
insert into public.boards (org_id, name) values ('0d000000-0000-4000-8000-000000000001', 'Weekday board');

-- careful@ has turned on an authenticator app.
insert into auth.mfa_factors (user_id, status) values ('b1111111-1111-4111-8111-111111111111', 'verified');
-- relaxed@ started setting one up and never finished — that doesn't count.
insert into auth.mfa_factors (user_id, status) values ('b2222222-2222-4222-8222-222222222222', 'unverified');

-- Password only.
select tests.authenticate_with('b1111111-1111-4111-8111-111111111111', 'careful@example.test', 'aal1');
set local role authenticated;
select tests.eq((select count(*) from public.boards), 0::bigint, 'with an app on, a password-only session reads nothing');
select tests.eq((select count(*) from public.orgs), 0::bigint, 'not even its own shul');
select tests.denied($$insert into public.boards (org_id, name) values ('0d000000-0000-4000-8000-000000000001', 'Sneaky')$$,
  'and writes nothing');
reset role;

-- After the code.
select tests.authenticate_with('b1111111-1111-4111-8111-111111111111', 'careful@example.test', 'aal2');
set local role authenticated;
select tests.eq((select count(*) from public.boards), 1::bigint, 'after the code, it reads its shul''s boards');
select tests.allowed($$insert into public.boards (org_id, name) values ('0d000000-0000-4000-8000-000000000001', 'Shabbos board')$$,
  'and writes');
reset role;

-- No app (an unfinished setup doesn't count).
select tests.authenticate_with('b2222222-2222-4222-8222-222222222222', 'relaxed@example.test', 'aal1');
set local role authenticated;
select tests.eq((select count(*) from public.boards), 2::bigint, 'an account without an app is unaffected');
reset role;

select tests.eq(
  (select count(*)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and not exists (
        select 1 from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname
           and p.permissive = 'RESTRICTIVE' and p.policyname = 'two-step sign-in, when on'
      )),
  0::bigint,
  'every RLS table in public has the two-step policy');

\o
do $$
declare failed bigint;
begin
  select count(*) into failed from tests.log where not ok;
  if failed > 0 then
    raise exception '% assertion(s) failed', failed;
  end if;
  raise notice 'all % two-step assertions passed', (select count(*) from tests.log);
end
$$;

rollback;
