-- Tenant root: orgs, org_members, and the three RLS helper functions every other
-- policy in the schema is built on.
--
-- A note on RLS being ENABLED but not FORCED, which holds for every table in this
-- schema. FORCE makes the table owner subject to RLS too. The helper functions
-- below are SECURITY DEFINER and run as the owner precisely so they can read
-- org_members without tripping the policy that calls them; forcing RLS would put
-- that read back under the policy and reintroduce the recursion the definer exists
-- to break. The same applies to request_org_rebuild(), which updates screens on
-- behalf of an editor who has no write access to screens. Nothing in this product
-- connects to Postgres as the table owner -- PostgREST connects as anon or
-- authenticated, and service_role bypasses RLS by design -- so FORCE would buy no
-- security here and would cost correctness.

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  timezone text not null default 'America/New_York',
  latitude double precision,
  longitude double precision,
  elevation_m integer,
  postal_code text,
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  zmanim_provider public.zmanim_provider not null default 'hebcal',
  myzmanim_location_id text,
  nusach public.nusach not null default 'ashkenaz',
  hebrew_prefs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(hebrew_prefs) = 'object'),
  theme jsonb not null default '{}'::jsonb
    check (jsonb_typeof(theme) = 'object'),
  plan text not null default 'free',
  screen_limit integer check (screen_limit is null or screen_limit > 0),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index orgs_slug_key on public.orgs (slug);

create trigger orgs_set_updated_at
  before update on public.orgs
  for each row execute function public.set_updated_at();

create table public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'viewer',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Load-bearing. Both helper functions probe by user_id first and the primary key
-- index leads with org_id, so without this index every RLS check in the product
-- is a scan. INCLUDE (role) makes has_org_role_at_least an index-only lookup.
create index org_members_user_org_idx
  on public.org_members (user_id, org_id) include (role);

create trigger org_members_set_updated_at
  before update on public.org_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER IS LOAD-BEARING HERE, NOT DECORATIVE. The RLS policy on
-- org_members calls this function, and this function reads org_members. Without
-- SECURITY DEFINER the read is itself subject to that policy, which calls this
-- function again, and Postgres raises "infinite recursion detected in policy for
-- relation org_members". It raises it at QUERY time, not at definition time, so a
-- change that drops SECURITY DEFINER passes review, deploys cleanly, and takes the
-- whole application down on the next request. Running as the definer bypasses RLS
-- on org_members and is what makes these policies terminate.
--
-- STABLE (not VOLATILE) lets the planner evaluate this once per statement in many
-- query shapes instead of once per row. It is the single largest performance lever
-- in the policy set and there is no error message when it is missing -- it just
-- gets slow.
--
-- SET search_path = '' with every reference schema-qualified: a SECURITY DEFINER
-- function with a mutable search_path is a privilege escalation waiting for
-- someone to create a shadowing table.
create function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = org
      and m.user_id = (select auth.uid())
  );
$$;

-- SECURITY DEFINER IS LOAD-BEARING HERE TOO, for exactly the reason spelled out
-- above is_org_member(): this function reads org_members and is called from the
-- policies on org_members, so without the definer the policy recurses into itself
-- and errors at query time rather than at definition time.
--
-- Ranking, not matching: has_org_role_at_least(org, 'editor') is true for an
-- editor, an admin and an owner. public.org_role is declared in ascending
-- privilege order so the comparison is a plain enum comparison.
--
-- An unrecognised role raises rather than returning false. The natural failure
-- mode of a typo -- 'admins', 'Editor' -- would otherwise be "returns false",
-- which silently locks people out of their own data instead of failing loudly the
-- first time the policy is hit.
create function public.has_org_role_at_least(org uuid, min_role text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  required public.org_role;
  actual public.org_role;
begin
  begin
    required := min_role::public.org_role;
  exception when invalid_text_representation then
    raise exception 'has_org_role_at_least: unknown role %', min_role
      using errcode = '22023';
  end;

  select m.role into actual
  from public.org_members m
  where m.org_id = org
    and m.user_id = (select auth.uid());

  return actual is not null and actual >= required;
end;
$$;

-- An optimisation escape hatch, not a requirement. A policy written as
-- `org_id in (select public.current_org_ids())` is planned as a single InitPlan
-- evaluated once per statement, where is_org_member(org_id) can be evaluated per
-- row on a sequential scan. Start with is_org_member for readability and switch
-- only the tables that measure badly.
--
-- SECURITY DEFINER for the same recursion reason as the two above.
create function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.org_members m
  where m.user_id = (select auth.uid());
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role_at_least(uuid, text) from public, anon;
revoke all on function public.current_org_ids() from public, anon;

grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.has_org_role_at_least(uuid, text) to authenticated, service_role;
grant execute on function public.current_org_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Membership integrity
-- ---------------------------------------------------------------------------

-- Creating an org is how you sign up, so the insert policy on orgs lets any
-- authenticated user create one. Without this trigger the creator would
-- immediately lose select access to the row they just made, because every policy
-- on orgs keys on membership. SECURITY DEFINER because the org_members insert
-- policy requires admin, and the creator is not a member yet.
create function public.orgs_add_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.org_members (org_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (org_id, user_id) do nothing;
  end if;
  return null;
end;
$$;

create trigger orgs_add_creator_as_owner
  after insert on public.orgs
  for each row execute function public.orgs_add_creator_as_owner();

-- Three rules RLS cannot express, because RLS filters rows and cannot compare the
-- new row against the rest of the table:
--   1. only an owner may grant the owner role
--   2. nobody may change their own role
--   3. an org must always retain at least one owner
-- Without (1) and (2) any admin can promote themselves to owner, which makes the
-- owner/admin split decorative.
create function public.org_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  owner_count integer;
begin
  -- Bootstrapping a brand new org has no owner to authorise the first one; the
  -- orgs_add_creator_as_owner trigger above is the only writer in that window.
  if tg_op = 'INSERT' and new.role = 'owner' then
    select count(*) into owner_count
    from public.org_members m
    where m.org_id = new.org_id and m.role = 'owner';

    if owner_count = 0 then
      return new;
    end if;
  end if;

  -- actor is null for service-role and maintenance work, which is trusted server
  -- code by definition. A signed-in user always has one.
  if actor is not null then
    if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner'
       and not public.has_org_role_at_least(new.org_id, 'owner') then
      raise exception 'only an owner may grant the owner role'
        using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and new.user_id = actor
       and new.role is distinct from old.role then
      raise exception 'you cannot change your own role'
        using errcode = '42501';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE')
     and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner') then
    select count(*) into owner_count
    from public.org_members m
    where m.org_id = old.org_id and m.role = 'owner';

    if owner_count <= 1 then
      raise exception 'an org must always have at least one owner'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger org_members_guard
  before insert or update or delete on public.org_members
  for each row execute function public.org_members_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.orgs enable row level security;

create policy "orgs are visible to their members"
  on public.orgs for select to authenticated
  using (public.is_org_member(id));

create policy "any authenticated user may create an org"
  on public.orgs for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "orgs are updated by admins"
  on public.orgs for update to authenticated
  using (public.has_org_role_at_least(id, 'admin'))
  with check (public.has_org_role_at_least(id, 'admin'));

create policy "orgs are deleted by owners"
  on public.orgs for delete to authenticated
  using (public.has_org_role_at_least(id, 'owner'));

alter table public.org_members enable row level security;

create policy "members are visible to their org"
  on public.org_members for select to authenticated
  using (public.is_org_member(org_id));

create policy "members are added by admins"
  on public.org_members for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'admin'));

create policy "members are updated by admins"
  on public.org_members for update to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'))
  with check (public.has_org_role_at_least(org_id, 'admin'));

-- The user_id branch is "leave org", which should not require being an admin.
create policy "members are removed by admins or by themselves"
  on public.org_members for delete to authenticated
  using (
    public.has_org_role_at_least(org_id, 'admin')
    or user_id = (select auth.uid())
  );
