-- Connecting a TV to a screen with a code, and one TV per screen.
--
-- THE FLOW. A TV opens /pair. It makes itself a device secret (kept in its own
-- storage for good) and asks POST /api/pair/start for a code; the server keeps
-- only the secret's SHA-256 here, beside a 6-digit code that lives 10 minutes.
-- The TV shows the code and a QR code. An admin, signed in on a phone or a
-- computer, enters the code against one of their screens — claim_pairing
-- below — which binds that screen to the TV's secret. The TV, polling
-- POST /api/pair/poll with its secret, gets the screen's link and never needs
-- a code again.
--
-- ONE TV PER SCREEN. screens.device_secret_hash is the bound TV. Every display
-- request (bundle, heartbeat, realtime auth) carries the TV's secret, and
-- lib/screen-token.ts refuses a screen's link from any other device — so a
-- copied link no longer puts the board on a second TV. "Disconnect TV" in the
-- dashboard clears the binding and rotates the token: the old TV is refused
-- on its next request and goes back to showing a code.
--
-- A screen that was set up by link before this has no binding; the first
-- device to present a secret with its link becomes its TV (the one on the
-- wall, which is polling around the clock), and from then on the rule holds.
--
-- pairing_requests IS NOT A TENANT TABLE. A request belongs to no shul until
-- it's claimed, so like zmanim_cache it has no org_id, and no policy at all:
-- only the service role (the two /api/pair routes) and claim_pairing touch it.
-- The unused screens.pairing_code columns from 20260904090500 were the
-- earlier sketch of this, a code shown in the dashboard and typed on the TV.

create table public.pairing_requests (
  id uuid primary key default gen_random_uuid(),
  -- Six digits: easy to read off a TV across a room and to type on a phone.
  code text not null check (code ~ '^[0-9]{6}$'),
  -- SHA-256 (hex) of the secret the TV holds; the secret itself never leaves it
  -- except to prove it's the same TV.
  device_secret_hash text not null check (device_secret_hash ~ '^[0-9a-f]{64}$'),
  -- What the TV said it was (a short label from its user agent).
  device_label text,
  requested_from text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_screen_id uuid references public.screens (id) on delete cascade,
  delivered_at timestamptz,
  constraint pairing_requests_claimed_together
    check ((claimed_at is null) = (claimed_screen_id is null))
);

-- A code is unique among the requests still waiting.
create unique index pairing_requests_open_code_key
  on public.pairing_requests (code) where claimed_at is null;
create index pairing_requests_device_idx on public.pairing_requests (device_secret_hash, created_at desc);
create index pairing_requests_from_idx on public.pairing_requests (requested_from, created_at desc);

alter table public.pairing_requests enable row level security;
-- No permissive policy: nothing but the service role and claim_pairing reads
-- or writes it. The restrictive two-step policy every RLS table carries
-- (20260925090000) goes on too, so the rule "every RLS table has it" holds.
create policy "two-step sign-in, when on" on public.pairing_requests
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));

alter table public.screens
  add column device_secret_hash text check (device_secret_hash is null or device_secret_hash ~ '^[0-9a-f]{64}$'),
  add column device_label text,
  add column device_paired_at timestamptz;

-- The same TV can't be two screens.
create unique index screens_device_secret_hash_key
  on public.screens (device_secret_hash) where device_secret_hash is not null;

-- ---------------------------------------------------------------------------
-- claim_pairing: an admin binds a waiting TV to one of their screens.
-- ---------------------------------------------------------------------------

create function public.claim_pairing(p_code text, p_screen_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.screens;
  request public.pairing_requests;
begin
  if (select auth.uid()) is null or not public.mfa_satisfied() then
    raise exception 'sign in to connect a TV' using errcode = '42501';
  end if;

  select * into target from public.screens where id = p_screen_id for update;
  if not found or not public.has_org_role_at_least(target.org_id, 'admin') then
    raise exception 'only an owner or admin can connect a TV to this screen' using errcode = '42501';
  end if;
  if target.device_secret_hash is not null then
    raise exception 'this screen already has a TV connected' using errcode = '22023';
  end if;

  select * into request
    from public.pairing_requests
   where code = regexp_replace(coalesce(p_code, ''), '\s', '', 'g')
     and claimed_at is null
     and expires_at > now()
   for update;
  if not found then
    raise exception 'that code is wrong or has expired' using errcode = '22023';
  end if;
  if exists (select 1 from public.screens s where s.device_secret_hash = request.device_secret_hash) then
    raise exception 'that TV is already connected to another screen' using errcode = '22023';
  end if;

  update public.screens
     set device_secret_hash = request.device_secret_hash,
         device_label = request.device_label,
         device_paired_at = now()
   where id = target.id;

  update public.pairing_requests
     set claimed_at = now(), claimed_by = (select auth.uid()), claimed_screen_id = target.id
   where id = request.id;

  return target.name;
end;
$$;

revoke all on function public.claim_pairing(text, uuid) from public;
grant execute on function public.claim_pairing(text, uuid) to authenticated;
