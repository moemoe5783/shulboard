-- Assets, albums, and the many-to-many between them.
--
-- Bundles reference assets by media-proxy path -- /m/<asset_id>/<variant>-<hash>.<ext>
-- -- and never by signed URL. See docs/schema.md §6.

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  kind public.asset_kind not null,
  storage_bucket text not null default 'assets',
  -- Convention: <org_id>/<asset_id>/original.<ext>. The leading segment is the
  -- org id so storage.objects policies can key on it.
  storage_path text not null,
  original_filename text,
  -- Post-conversion. HEIC never survives to here as a servable type.
  mime_type text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  -- Generated, so it cannot disagree with the dimensions. Collage template
  -- matching (plan §7) scores against this on every re-roll.
  aspect_ratio numeric generated always as
    (width::numeric / nullif(height, 0)::numeric) stored,
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  checksum_sha256 text,
  variants jsonb not null default '{}'::jsonb
    check (jsonb_typeof(variants) = 'object'),
  status public.asset_status not null default 'pending',
  processing_error text,
  -- Derivatives must have GPS stripped before they are servable.
  exif_stripped boolean not null default false,
  caption text,
  uploaded_by uuid references auth.users (id) on delete set null,
  upload_source public.upload_source not null default 'dashboard',
  moderation_status public.moderation_status not null default 'approved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete, so a board document referencing this asset keeps pointing at
  -- something restorable rather than at a hole. Nothing enforces that reference.
  deleted_at timestamptz,
  constraint assets_id_org_key unique (id, org_id)
);

create unique index assets_org_checksum_key
  on public.assets (org_id, checksum_sha256)
  where checksum_sha256 is not null;
create index assets_org_created_idx
  on public.assets (org_id, created_at desc) where deleted_at is null;
create index assets_processing_idx
  on public.assets (org_id, status) where status <> 'ready';
create index assets_moderation_queue_idx
  on public.assets (org_id, moderation_status) where moderation_status = 'pending';

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

alter table public.assets enable row level security;

create policy "assets are visible to their org"
  on public.assets for select to authenticated
  using (public.is_org_member(org_id));

create policy "assets are created by editors"
  on public.assets for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "assets are updated by editors"
  on public.assets for update to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'))
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "assets are deleted by editors"
  on public.assets for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'));

-- RLS here protects the metadata, not the bytes. storage.objects needs a
-- parallel set of policies keyed on the first path segment of name being an org
-- the user belongs to. Getting one right and forgetting the other is the most
-- common way a multi-tenant Supabase app leaks files.

create table public.albums (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text,
  -- All four enum values exist from the first migration; v1 only ever writes
  -- 'manual' (plan §6). Drop this check when the first sync worker ships.
  source public.album_source not null default 'manual' check (source = 'manual'),
  source_config jsonb,
  cover_asset_id uuid,
  -- The /u/<token> shareable upload link.
  share_token text,
  share_enabled boolean not null default false,
  share_expires_at timestamptz,
  moderation_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete, same reason as assets.
  deleted_at timestamptz,
  constraint albums_id_org_key unique (id, org_id),
  constraint albums_cover_asset_fk
    foreign key (cover_asset_id, org_id)
    references public.assets (id, org_id) on delete set null
);

create unique index albums_share_token_key
  on public.albums (share_token) where share_token is not null;
create index albums_org_idx on public.albums (org_id) where deleted_at is null;

create trigger albums_set_updated_at
  before update on public.albums
  for each row execute function public.set_updated_at();

alter table public.albums enable row level security;

create policy "albums are visible to their org"
  on public.albums for select to authenticated
  using (public.is_org_member(org_id));

create policy "albums are created by editors"
  on public.albums for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "albums are updated by editors"
  on public.albums for update to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'))
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "albums are deleted by editors"
  on public.albums for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'));

create table public.album_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  album_id uuid not null,
  asset_id uuid not null,
  position numeric not null,
  -- Per-album override; falls back to assets.caption.
  caption text,
  created_at timestamptz not null default now(),
  constraint album_items_album_fk
    foreign key (album_id, org_id)
    references public.albums (id, org_id) on delete cascade,
  constraint album_items_asset_fk
    foreign key (asset_id, org_id)
    references public.assets (id, org_id) on delete cascade
);

create unique index album_items_album_asset_key
  on public.album_items (album_id, asset_id);
create index album_items_album_position_idx
  on public.album_items (album_id, position);
create index album_items_asset_idx on public.album_items (asset_id);
create index album_items_org_idx on public.album_items (org_id);

alter table public.album_items enable row level security;

create policy "album items are visible to their org"
  on public.album_items for select to authenticated
  using (public.is_org_member(org_id));

create policy "album items are created by editors"
  on public.album_items for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "album items are updated by editors"
  on public.album_items for update to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'))
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "album items are deleted by editors"
  on public.album_items for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'));
