-- Google Calendar connections and the tenant-scoped event cache they fill.

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  provider public.calendar_provider not null default 'google',
  -- Shown in settings so a gabbai can tell which account broke.
  account_email text,
  calendar_id text not null,
  calendar_name text,

  -- THE REFRESH TOKEN IS NOT A COLUMN ON THIS TABLE, and must not become one.
  -- RLS filters rows, not columns: a token stored here would be readable by every
  -- viewer in the org, because they can select the row. This points at Supabase
  -- Vault instead, and only the sync worker -- server-only, service role -- can
  -- resolve it.
  vault_secret_id uuid,

  sync_token text,
  sync_status public.sync_status not null default 'never',
  sync_error text,
  last_synced_at timestamptz,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_connections_id_org_key unique (id, org_id)
);

-- Connecting the same calendar twice is always a mistake.
create unique index calendar_connections_unique_calendar
  on public.calendar_connections (org_id, provider, calendar_id);
create index calendar_connections_org_idx on public.calendar_connections (org_id);
create index calendar_connections_sync_queue_idx
  on public.calendar_connections (sync_status, last_synced_at);

create trigger calendar_connections_set_updated_at
  before update on public.calendar_connections
  for each row execute function public.set_updated_at();

alter table public.calendar_connections enable row level security;

create policy "calendar connections are visible to their org"
  on public.calendar_connections for select to authenticated
  using (public.is_org_member(org_id));

create policy "calendar connections are created by admins"
  on public.calendar_connections for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'admin'));

create policy "calendar connections are updated by admins"
  on public.calendar_connections for update to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'))
  with check (public.has_org_role_at_least(org_id, 'admin'));

create policy "calendar connections are deleted by admins"
  on public.calendar_connections for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'));

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  connection_id uuid not null,
  external_id text not null,
  -- The master's id when this row is an expanded instance.
  recurring_event_id text,
  ical_uid text,
  title text not null,
  description text,
  location text,
  is_all_day boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  -- An all-day event is a date, not an instant. Storing it as midnight in some
  -- zone is how it lands on the wrong day on a screen in another timezone.
  start_date date,
  end_date date,
  timezone text,
  status public.calendar_event_status not null default 'confirmed',
  html_link text,
  remote_etag text,
  remote_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint calendar_events_connection_fk
    foreign key (connection_id, org_id)
    references public.calendar_connections (id, org_id) on delete cascade,
  -- Exactly one shape, consistent with is_all_day.
  constraint calendar_events_time_shape check (
    (is_all_day
      and start_date is not null and end_date is not null
      and starts_at is null and ends_at is null)
    or (not is_all_day
      and starts_at is not null and ends_at is not null
      and start_date is null and end_date is null)
  )
);

-- The upsert target for incremental sync.
create unique index calendar_events_external_key
  on public.calendar_events (connection_id, external_id);
-- The builder's 30-day lookahead.
create index calendar_events_lookahead_idx
  on public.calendar_events (org_id, starts_at) where status <> 'cancelled';
create index calendar_events_all_day_lookahead_idx
  on public.calendar_events (org_id, start_date) where status <> 'cancelled';
-- Finding rows the last sync did not touch.
create index calendar_events_sync_idx
  on public.calendar_events (connection_id, synced_at);

create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

alter table public.calendar_events enable row level security;

create policy "calendar events are visible to their org"
  on public.calendar_events for select to authenticated
  using (public.is_org_member(org_id));

-- No write policies. Like zmanim_cache this is a cache: only the sync worker
-- writes it, with the service role. A client-writable event cache would let an
-- editor put words on a lobby screen that never existed in the shul's calendar.
