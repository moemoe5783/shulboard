-- Pending invitations by email (plan.md §8).

create table public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  -- Ownership is transferred deliberately, never handed out by an invite link.
  role public.org_role not null default 'viewer' check (role <> 'owner'),
  token text not null,
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_invites_expires_after_creation check (expires_at > created_at),
  constraint org_invites_accepted_together
    check ((accepted_at is null) = (accepted_by is null))
);

-- Status is derived from the timestamps rather than stored, so a row cannot claim
-- to be pending while holding an accepted_at.
create unique index org_invites_token_key on public.org_invites (token);

create unique index org_invites_one_live_per_email
  on public.org_invites (org_id, email)
  where accepted_at is null and revoked_at is null;

create index org_invites_org_created_idx
  on public.org_invites (org_id, created_at desc);

create index org_invites_expiry_idx
  on public.org_invites (expires_at)
  where accepted_at is null and revoked_at is null;

create trigger org_invites_set_updated_at
  before update on public.org_invites
  for each row execute function public.set_updated_at();

alter table public.org_invites enable row level security;

-- Select is admin, not member: this table is a list of people's email addresses
-- and a viewer has no reason to read it.
create policy "invites are visible to admins"
  on public.org_invites for select to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'));

create policy "invites are created by admins"
  on public.org_invites for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'admin'));

create policy "invites are updated by admins"
  on public.org_invites for update to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'))
  with check (public.has_org_role_at_least(org_id, 'admin'));

create policy "invites are deleted by admins"
  on public.org_invites for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'));

-- There is deliberately no policy that lets an invitee read their own invite by
-- token. The person clicking the link is not a member yet, so no policy keyed on
-- membership can authorise the lookup, and a policy permissive enough to allow it
-- would expose every invite in the product. Acceptance runs in a server-only
-- route holding the service role: validate the token, check expires_at /
-- accepted_at / revoked_at, insert the org_members row and stamp accepted_at, all
-- in one transaction.
