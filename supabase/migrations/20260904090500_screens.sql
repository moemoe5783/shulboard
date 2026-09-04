-- Screens. A screen points at a PLAYLIST, never at a board -- there is no
-- board_id column here and adding one to "simplify the common case" is how you
-- lose dayparting (plan.md §1).

create table public.screens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  location_note text,
  -- 32 chars, CSPRNG, base32 or base58 with no ambiguous glyphs. Globally unique,
  -- not per org: it is the display route's only lookup.
  token text not null check (length(token) >= 32),
  token_rotated_at timestamptz,
  pairing_code text,
  pairing_code_expires_at timestamptz,
  playlist_id uuid,
  orientation public.screen_orientation not null default 'landscape',
  canvas_width integer not null default 1920 check (canvas_width > 0),
  canvas_height integer not null default 1080 check (canvas_height > 0),
  timezone text,
  latitude double precision,
  longitude double precision,
  elevation_m integer,
  postal_code text,
  zmanim_provider public.zmanim_provider,
  zmanim_location_id text,
  hebrew_prefs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(hebrew_prefs) = 'object'),

  -- Rebuild queue state. Defaulting to now() means a newly created screen is
  -- queued for its first build without needing an insert trigger.
  rebuild_requested_at timestamptz default now(),
  rebuild_last_attempt_at timestamptz,
  rebuild_attempts integer not null default 0,
  rebuild_last_error text,

  -- Denormalised from screen_heartbeats. The screens view renders from these,
  -- never from a join against the heartbeat history.
  last_seen_at timestamptz,
  last_seen_bundle_version integer,
  last_seen_board_id uuid,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint screens_id_org_key unique (id, org_id),
  constraint screens_playlist_fk
    foreign key (playlist_id, org_id)
    references public.playlists (id, org_id) on delete set null,
  constraint screens_pairing_code_expiry
    check (pairing_code is null or pairing_code_expires_at is not null)
);

-- There is deliberately no bundle_version column. The version currently being
-- served lives on screen_bundles, which is the row that changes when a build
-- succeeds; a second copy here would be a second source of truth for the one
-- value the display polls on.

create unique index screens_token_key on public.screens (token);
create unique index screens_pairing_code_key
  on public.screens (pairing_code) where pairing_code is not null;
create index screens_org_idx on public.screens (org_id);
create index screens_playlist_idx on public.screens (playlist_id);
create index screens_org_last_seen_idx on public.screens (org_id, last_seen_at desc);
-- The build worker's queue. Stays tiny because rows leave it on success.
create index screens_rebuild_queue_idx
  on public.screens (rebuild_requested_at)
  where rebuild_requested_at is not null;

create trigger screens_set_updated_at
  before update on public.screens
  for each row execute function public.set_updated_at();

alter table public.screens enable row level security;

create policy "screens are visible to their org"
  on public.screens for select to authenticated
  using (public.is_org_member(org_id));

-- Screens are admin, not editor (plan.md §8): an editor rotating a token
-- silently blacks out a lobby.
create policy "screens are created by admins"
  on public.screens for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'admin'));

create policy "screens are updated by admins"
  on public.screens for update to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'))
  with check (public.has_org_role_at_least(org_id, 'admin'));

create policy "screens are deleted by admins"
  on public.screens for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'));

-- The display route never touches these policies. It validates the token in a
-- server-only route and reads with the service role.
