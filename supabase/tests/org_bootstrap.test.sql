-- Org bootstrap.
--
-- Covers what happens the first time somebody signs in: they create a shul, and
-- that has to produce exactly one owner and nothing visible to anyone else.
--
-- Run with: npm run test:db

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

begin;

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'first@example.test'),
  ('b2222222-2222-4222-8222-222222222222', 'second@example.test');

-- ---------------------------------------------------------------------------
-- Creating an org, exactly as the app does it: an ordinary authenticated insert
-- through RLS. No service role, no second insert to create the membership.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('a1111111-1111-4111-8111-111111111111');
set local role authenticated;

-- INSERT ... RETURNING is refused, and that is worth pinning down.
--
-- Postgres applies the SELECT policy to RETURNING; the orgs SELECT policy is
-- is_org_member(id); and the membership is created by an AFTER INSERT trigger
-- that has not fired yet. So the creator cannot read back the row they are
-- inserting, in the same statement. The app inserts without RETURNING and reads
-- the row afterwards. If this assertion ever starts failing, the trigger timing
-- changed and app/(app)/actions.ts can be simplified.
do $$
declare probe uuid;
begin
  begin
    insert into public.orgs (name, slug, timezone, created_by)
    values ('Returning probe', 'returning-probe', 'UTC',
            'a1111111-1111-4111-8111-111111111111')
    returning id into probe;
  exception when insufficient_privilege then
    perform tests.pass(
      'org creation: INSERT ... RETURNING is refused, because the membership does not exist yet');
    return;
  end;
  perform tests.fail(
    'org creation: INSERT ... RETURNING succeeded -- the trigger timing changed, simplify createOrg');
end
$$;

do $$
declare
  new_org uuid;
  owners bigint;
  members bigint;
  creator_role public.org_role;
begin
  -- The path the app actually takes: insert, then read back.
  insert into public.orgs (name, slug, timezone, created_by)
  values ('Beis Menachem', 'beis-menachem', 'America/New_York',
          'a1111111-1111-4111-8111-111111111111');

  select o.id into new_org from public.orgs o where o.slug = 'beis-menachem';

  perform tests.ok(new_org is not null, 'org creation: an authenticated user may create a shul');

  -- The membership comes from the orgs_add_creator_as_owner trigger, in the same
  -- transaction. Without it the creator would immediately lose select access to
  -- the row they just made, because every policy on orgs keys on membership.
  select count(*) into members from public.org_members m where m.org_id = new_org;
  perform tests.eq(members, 1::bigint, 'org creation: exactly one membership row');

  select count(*) into owners
  from public.org_members m where m.org_id = new_org and m.role = 'owner';
  perform tests.eq(owners, 1::bigint, 'org creation: exactly one owner');

  select m.role into creator_role
  from public.org_members m
  where m.org_id = new_org
    and m.user_id = 'a1111111-1111-4111-8111-111111111111';
  perform tests.ok(creator_role = 'owner', 'org creation: the creator is the owner');

  -- The point of the trigger: the creator can read back what they just made.
  perform tests.eq(
    (select count(*) from public.orgs o where o.id = new_org),
    1::bigint,
    'org creation: the creator can read their new shul');
end
$$;

-- A second shul for the same user, which the switcher has to be able to list.
do $$
begin
  insert into public.orgs (name, slug, timezone, created_by)
  values ('Ohel Moshe', 'ohel-moshe', 'America/Chicago',
          'a1111111-1111-4111-8111-111111111111');

  perform tests.eq(
    (select count(*) from public.orgs),
    2::bigint,
    'switcher: a user in two shuls sees both');

  perform tests.eq(
    (select count(*) from public.org_members m
      where m.user_id = 'a1111111-1111-4111-8111-111111111111'),
    2::bigint,
    'switcher: two memberships, one per shul');
end
$$;

-- Impersonation: created_by is checked by the insert policy, so a user cannot
-- create a shul owned by somebody else.
do $$
begin
  begin
    insert into public.orgs (name, slug, timezone, created_by)
    values ('Not mine', 'not-mine', 'UTC', 'b2222222-2222-4222-8222-222222222222');
  exception when insufficient_privilege then
    perform tests.pass('org creation: cannot create a shul in another user''s name');
    return;
  end;
  perform tests.fail('org creation: created a shul in another user''s name');
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- The second user. Signed in, but a member of nothing.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('b2222222-2222-4222-8222-222222222222');
set local role authenticated;

do $$
begin
  perform tests.eq(
    (select count(*) from public.orgs),
    0::bigint,
    'isolation: a user sees none of another user''s shuls');

  perform tests.eq(
    (select count(*) from public.org_members),
    0::bigint,
    'isolation: a user sees none of another user''s memberships');

  -- This is the state that sends someone to the org creation step.
  perform tests.ok(
    not public.is_org_member(
      (select o.id from public.orgs o limit 1)),
    'isolation: is_org_member is false for a user with no orgs');
end
$$;

-- Their own shul, and still only their own.
do $$
begin
  insert into public.orgs (name, slug, timezone, created_by)
  values ('Ohr Yisroel', 'ohr-yisroel', 'Europe/London',
          'b2222222-2222-4222-8222-222222222222');

  perform tests.eq(
    (select count(*) from public.orgs),
    1::bigint,
    'isolation: after creating one, a user sees exactly their own');

  perform tests.eq(
    (select count(*) from public.org_members m where m.role = 'owner'),
    1::bigint,
    'isolation: and exactly one owner row, their own');
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
  raise notice 'all % org bootstrap assertions passed', (select count(*) from tests.log);
end
$$;

rollback;
