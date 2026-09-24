-- Members and invitations, end to end (plan.md §8).
--
-- org_invites (20260904090200) left acceptance to "a server-only route
-- holding the service role". It's done here instead with three narrow
-- SECURITY DEFINER functions, so no new code holds that key (CLAUDE.md): each
-- does one thing, checks its own authority, and is the only way to it.
--
--   invite_preview(token)       anyone holding the link: who's inviting, to
--                               which shul, as what — so a person with no
--                               account can see what they're signing up for.
--   accept_org_invite(token)    the signed-in invitee: joins the shul. The
--                               account's email must be the one invited.
--   org_member_directory(org)   a member: the shul's people, with the name and
--                               email that live in auth.users, which the
--                               dashboard can't read directly.

-- ---------------------------------------------------------------------------
-- The guard, tightened: an admin manages editors, viewers and other admins,
-- but only an owner may change or remove an owner. (Leaving is still allowed:
-- anyone may delete their own row, subject to the last-owner rule.)
-- ---------------------------------------------------------------------------

create or replace function public.org_members_guard()
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
  -- orgs_add_creator_as_owner trigger is the only writer in that window.
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

    if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and old.user_id <> actor
       and not public.has_org_role_at_least(old.org_id, 'owner') then
      raise exception 'only an owner may change or remove an owner'
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

-- ---------------------------------------------------------------------------
-- invite_preview
-- ---------------------------------------------------------------------------

create function public.invite_preview(p_token text)
returns table (
  org_id uuid,
  org_name text,
  email text,
  role public.org_role,
  invited_by_name text,
  status text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.org_id,
    o.name,
    i.email,
    i.role,
    coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email),
    case
      when i.revoked_at is not null then 'revoked'
      when i.accepted_at is not null then 'accepted'
      when i.expires_at <= now() then 'expired'
      else 'pending'
    end,
    i.expires_at
  from public.org_invites i
  join public.orgs o on o.id = i.org_id
  left join auth.users u on u.id = i.invited_by
  -- The token is the whole credential: 24 random bytes, and nothing else about
  -- an invite is returned without it.
  where i.token = p_token and length(p_token) >= 24;
$$;

-- ---------------------------------------------------------------------------
-- accept_org_invite
-- ---------------------------------------------------------------------------

create function public.accept_org_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  invite public.org_invites;
begin
  if actor is null then
    raise exception 'sign in to accept this invitation' using errcode = '42501';
  end if;
  -- SECURITY DEFINER skips the table policies, including the two-step one
  -- (20260925090000), so it's checked here: a password-only session of an
  -- account with an authenticator app can't join anything.
  if not public.mfa_satisfied() then
    raise exception 'finish two-step sign-in first' using errcode = '42501';
  end if;

  select * into invite from public.org_invites where token = p_token and length(p_token) >= 24 for update;
  if not found then
    raise exception 'this invitation does not exist' using errcode = 'P0002';
  end if;
  if invite.revoked_at is not null then
    raise exception 'this invitation was withdrawn' using errcode = '22023';
  end if;

  -- Already joined (a second click on the same link): nothing to do.
  if invite.accepted_at is not null then
    if invite.accepted_by = actor then
      return invite.org_id;
    end if;
    raise exception 'this invitation was already used' using errcode = '22023';
  end if;

  if invite.expires_at <= now() then
    raise exception 'this invitation has expired' using errcode = '22023';
  end if;

  -- The link went to one address; only the account with that address may use
  -- it. Supabase Auth confirms an address before it signs anyone in with it
  -- (enable_confirmations), and Google's addresses are verified.
  if actor_email <> invite.email then
    raise exception 'this invitation is for a different email address' using errcode = '42501';
  end if;

  -- An existing member keeps the role they have; the invite is just used up.
  insert into public.org_members (org_id, user_id, role, invited_by)
  values (invite.org_id, actor, invite.role, invite.invited_by)
  on conflict (org_id, user_id) do nothing;

  update public.org_invites
     set accepted_at = now(), accepted_by = actor
   where id = invite.id;

  return invite.org_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- org_member_directory
-- ---------------------------------------------------------------------------

create function public.org_member_directory(p_org uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  role public.org_role,
  joined_at timestamptz,
  two_step boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.user_id,
    u.email,
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    m.role,
    m.created_at,
    exists (
      select 1 from auth.mfa_factors f
      where f.user_id = m.user_id and f.status = 'verified'
    )
  from public.org_members m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org
    -- Only the shul's own members see its list — and, as SECURITY DEFINER
    -- skips the table policies, only once two-step sign-in is satisfied.
    and public.is_org_member(p_org)
    and public.mfa_satisfied()
  order by m.created_at;
$$;

revoke all on function public.invite_preview(text) from public;
revoke all on function public.accept_org_invite(text) from public;
revoke all on function public.org_member_directory(uuid) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
grant execute on function public.accept_org_invite(text) to authenticated;
grant execute on function public.org_member_directory(uuid) to authenticated;
