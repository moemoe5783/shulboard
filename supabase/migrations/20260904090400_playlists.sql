-- Playlists and the ordered, scheduled set of boards they hold.

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text,
  default_duration_seconds integer not null default 30
    check (default_duration_seconds > 0),
  transition text not null default 'crossfade',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playlists_id_org_key unique (id, org_id)
);

create unique index playlists_org_name_key on public.playlists (org_id, lower(name));
create index playlists_org_idx on public.playlists (org_id);

create trigger playlists_set_updated_at
  before update on public.playlists
  for each row execute function public.set_updated_at();

alter table public.playlists enable row level security;

create policy "playlists are visible to their org"
  on public.playlists for select to authenticated
  using (public.is_org_member(org_id));

create policy "playlists are created by editors"
  on public.playlists for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "playlists are updated by editors"
  on public.playlists for update to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'))
  with check (public.has_org_role_at_least(org_id, 'editor'));

-- Delete is admin: deleting a playlist a screen points at is a blanking
-- operation, even with on delete set null.
create policy "playlists are deleted by admins"
  on public.playlists for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'));

create table public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  playlist_id uuid not null,
  board_id uuid not null,
  -- Fractional: inserting between 1.0 and 2.0 as 1.5 rewrites one row, not the
  -- whole list.
  position numeric not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  schedule jsonb not null default '{}'::jsonb
    check (jsonb_typeof(schedule) = 'object'),
  priority integer not null default 0,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite FKs, not plain ones. The denormalised org_id is what keeps the RLS
  -- policy from joining up to the parent, and these constraints are what keep it
  -- honest: a row physically cannot point at a playlist or a board in another org.
  constraint playlist_items_playlist_fk
    foreign key (playlist_id, org_id)
    references public.playlists (id, org_id) on delete cascade,

  -- on delete restrict, deliberately: deleting a board that is scheduled on a
  -- live screen should fail loudly and name the playlist holding it, rather than
  -- silently emptying a rotation.
  constraint playlist_items_board_fk
    foreign key (board_id, org_id)
    references public.boards (id, org_id) on delete restrict
);

create unique index playlist_items_position_key
  on public.playlist_items (playlist_id, position);
create index playlist_items_playlist_position_idx
  on public.playlist_items (playlist_id, position);
create index playlist_items_board_idx on public.playlist_items (board_id);
create index playlist_items_org_idx on public.playlist_items (org_id);

create trigger playlist_items_set_updated_at
  before update on public.playlist_items
  for each row execute function public.set_updated_at();

alter table public.playlist_items enable row level security;

create policy "playlist items are visible to their org"
  on public.playlist_items for select to authenticated
  using (public.is_org_member(org_id));

create policy "playlist items are created by editors"
  on public.playlist_items for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "playlist items are updated by editors"
  on public.playlist_items for update to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'))
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "playlist items are deleted by editors"
  on public.playlist_items for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'));
