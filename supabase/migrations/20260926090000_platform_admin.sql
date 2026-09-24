-- The platform admin: the people who run Shulboard itself, across every shul.
--
-- WHAT IT CAN DO. See every shul — its plan, screens, members, photos and
-- storage — change a shul's plan (free trial, basic, pro) and its trial end,
-- and make other accounts platform admins. Nothing else: it does not read a
-- shul's boards or notices, and it is not a member of any shul.
--
-- HOW, WITHOUT THE SERVICE-ROLE KEY. The same pattern as invitations
-- (20260925090100): narrow SECURITY DEFINER functions, each checking
-- is_platform_admin() itself, each the only way to the one thing it does. So
-- the admin pages run under the admin's own session and CLAUDE.md's list of
-- key holders doesn't grow. Every one also needs mfa_satisfied(): an admin
-- account with an authenticator app on has to have used it, as everywhere else.
--
-- THE FIRST ADMIN is made by hand, once, in the Supabase SQL editor — there is
-- nobody yet to grant it (docs/environment.md, "Platform admin"):
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = '<your email>';
--
-- STRIPE comes later. Its two ids are here now so the admin pages and the
-- billing webhook will read and write one set of columns, and so the guard
-- below already covers them.

-- ---------------------------------------------------------------------------
-- Who is a platform admin
-- ---------------------------------------------------------------------------

-- Not a tenant table — it belongs to no shul — so it has no org_id
-- (CLAUDE.md's rule is for tenant tables). RLS is on all the same.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.mfa_satisfied()
     and exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to anon, authenticated;

-- Admins can see who the admins are; nobody writes this table directly
-- (platform_set_admin below does).
create policy "platform admins see platform admins" on public.platform_admins
  for select to authenticated
  using ((select public.is_platform_admin()));

create policy "two-step sign-in, when on" on public.platform_admins
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

-- ---------------------------------------------------------------------------
-- A shul's plan
-- ---------------------------------------------------------------------------

-- `plan` has been on orgs since the first migration, as a free-form 'free'.
-- It becomes one of three, 'free' meaning what it always meant: not paying yet.
update public.orgs set plan = 'trial' where plan is null or plan not in ('trial', 'basic', 'pro');

alter table public.orgs
  alter column plan set default 'trial',
  add constraint orgs_plan_check check (plan in ('trial', 'basic', 'pro')),
  -- When a free trial ends. Null: no end set. Nothing enforces it yet — it's
  -- what the admin pages show and set, and what billing will read.
  add column trial_ends_at timestamptz,
  add column stripe_customer_id text,
  add column stripe_subscription_id text;

-- A new shul starts a 30-day trial.
alter table public.orgs alter column trial_ends_at set default (now() + interval '30 days');

-- A shul's own admins can update its row (its name, its address) — but not
-- its plan, its trial, or its billing ids. Only a platform admin, or trusted
-- server code (no signed-in user: the service role, the billing webhook), can.
create function public.orgs_plan_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not public.is_platform_admin()
     and (new.plan is distinct from old.plan
       or new.trial_ends_at is distinct from old.trial_ends_at
       or new.screen_limit is distinct from old.screen_limit
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id) then
    raise exception 'only a platform admin can change a shul''s plan'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger orgs_plan_guard
  before update on public.orgs
  for each row execute function public.orgs_plan_guard();

-- The same on the way in: a shul created from the dashboard starts on the
-- trial, whatever the insert says.
create function public.orgs_plan_on_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_platform_admin() then
    new.plan := 'trial';
    new.trial_ends_at := now() + interval '30 days';
    new.screen_limit := null;
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
  end if;
  return new;
end;
$$;

create trigger orgs_plan_on_create
  before insert on public.orgs
  for each row execute function public.orgs_plan_on_create();

-- ---------------------------------------------------------------------------
-- The admin's view: every shul
-- ---------------------------------------------------------------------------

create function public.platform_orgs()
returns table (
  org_id uuid,
  name text,
  slug text,
  created_at timestamptz,
  deleted_at timestamptz,
  plan text,
  trial_ends_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  owner_email text,
  member_count bigint,
  screen_count bigint,
  -- Screens that checked in during the last 10 minutes.
  screens_live bigint,
  board_count bigint,
  photo_count bigint,
  -- Every stored file: originals and every size made from them, including
  -- photos deleted in Media whose files are still held.
  storage_bytes bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    o.name,
    o.slug,
    o.created_at,
    o.deleted_at,
    o.plan,
    o.trial_ends_at,
    o.stripe_customer_id,
    o.stripe_subscription_id,
    (select u.email from public.org_members m join auth.users u on u.id = m.user_id
      where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1),
    (select count(*) from public.org_members m where m.org_id = o.id),
    (select count(*) from public.screens s where s.org_id = o.id),
    (select count(*) from public.screens s where s.org_id = o.id and s.last_seen_at > now() - interval '10 minutes'),
    (select count(*) from public.boards b where b.org_id = o.id and b.deleted_at is null),
    (select count(*) from public.assets a where a.org_id = o.id and a.deleted_at is null),
    (select coalesce(sum(
        coalesce(a.byte_size, 0)
        + coalesce((select sum(coalesce((v.value ->> 'bytes')::bigint, 0)) from jsonb_each(a.variants) v
                      where jsonb_typeof(v.value) = 'object'), 0)
      ), 0)::bigint
      from public.assets a where a.org_id = o.id)
  from public.orgs o
  where public.is_platform_admin()
  order by o.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Changing a shul's plan
-- ---------------------------------------------------------------------------

create function public.platform_set_org_plan(p_org uuid, p_plan text, p_trial_ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can change a shul''s plan' using errcode = '42501';
  end if;
  if p_plan not in ('trial', 'basic', 'pro') then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;
  update public.orgs
     set plan = p_plan,
         -- A trial's end only means something on the trial.
         trial_ends_at = case when p_plan = 'trial' then p_trial_ends_at else null end
   where id = p_org;
  if not found then
    raise exception 'no such shul' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Every account, and making one a platform admin
-- ---------------------------------------------------------------------------

create function public.platform_users(p_search text default null)
returns table (
  user_id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_platform_admin boolean,
  two_step boolean,
  shuls text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    u.email,
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    u.created_at,
    u.last_sign_in_at,
    exists (select 1 from public.platform_admins a where a.user_id = u.id),
    exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
    (select string_agg(o.name, ', ' order by o.name)
       from public.org_members m join public.orgs o on o.id = m.org_id
      where m.user_id = u.id)
  from auth.users u
  where public.is_platform_admin()
    and (p_search is null or btrim(p_search) = ''
      or u.email ilike '%' || btrim(p_search) || '%'
      or (u.raw_user_meta_data ->> 'full_name') ilike '%' || btrim(p_search) || '%')
  order by exists (select 1 from public.platform_admins a where a.user_id = u.id) desc, u.created_at desc
  limit 200;
$$;

create function public.platform_set_admin(p_user uuid, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if not public.is_platform_admin() then
    raise exception 'only a platform admin can do that' using errcode = '42501';
  end if;
  if p_admin then
    insert into public.platform_admins (user_id, granted_by) values (p_user, actor)
    on conflict (user_id) do nothing;
  else
    -- Removing yourself is how the last admin locks everyone out; another
    -- admin can remove you.
    if p_user = actor then
      raise exception 'you can''t remove yourself as a platform admin' using errcode = '42501';
    end if;
    delete from public.platform_admins where user_id = p_user;
  end if;
end;
$$;

revoke all on function public.platform_orgs() from public;
revoke all on function public.platform_set_org_plan(uuid, text, timestamptz) from public;
revoke all on function public.platform_users(text) from public;
revoke all on function public.platform_set_admin(uuid, boolean) from public;
grant execute on function public.platform_orgs() to authenticated;
grant execute on function public.platform_set_org_plan(uuid, text, timestamptz) to authenticated;
grant execute on function public.platform_users(text) to authenticated;
grant execute on function public.platform_set_admin(uuid, boolean) to authenticated;
