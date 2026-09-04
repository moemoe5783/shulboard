-- Announcements. Called "notices" everywhere in the UI (design.md §4); the table
-- keeps the longer name, the interface does not.

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  body text,
  status public.announcement_status not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  is_pinned boolean not null default false,
  priority integer not null default 0,
  asset_id uuid,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_asset_fk
    foreign key (asset_id, org_id)
    references public.assets (id, org_id) on delete set null,
  constraint announcements_window check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

-- The bundle builder's only query against this table.
create index announcements_active_window_idx
  on public.announcements (org_id, starts_at, ends_at)
  where status = 'published';
create index announcements_dashboard_idx
  on public.announcements (org_id, status, updated_at desc);

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

alter table public.announcements enable row level security;

create policy "announcements are visible to their org"
  on public.announcements for select to authenticated
  using (public.is_org_member(org_id));

create policy "announcements are created by editors"
  on public.announcements for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "announcements are updated by editors"
  on public.announcements for update to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'))
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "announcements are deleted by editors"
  on public.announcements for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'));
