-- The built bundle and the telemetry that says whether a screen is alive.

create table public.screen_bundles (
  -- The screen IS the key: there is exactly one current bundle per screen, and
  -- that is what makes "a failed build leaves the previous bundle serving" work.
  screen_id uuid primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  version integer not null default 1 check (version > 0),
  -- sha256 of the payload, served verbatim as the ETag (plan §3a).
  content_hash text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  byte_size integer not null check (byte_size >= 0),
  ttl_seconds integer not null default 3600 check (ttl_seconds > 0),
  built_at timestamptz not null default now(),
  build_duration_ms integer,
  -- What went in: the zmanim rows' fetched_at, the calendar synced_at, content
  -- timestamps. Turns "why is this screen showing last week's times" into a
  -- lookup instead of an investigation.
  source_versions jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint screen_bundles_screen_fk
    foreign key (screen_id, org_id)
    references public.screens (id, org_id) on delete cascade
);

create index screen_bundles_org_idx on public.screen_bundles (org_id);
create index screen_bundles_built_at_idx on public.screen_bundles (built_at);

create trigger screen_bundles_set_updated_at
  before update on public.screen_bundles
  for each row execute function public.set_updated_at();

-- THE 304 PATH MUST NOT READ payload. A poll carrying If-None-Match needs only
-- version and content_hash. Postgres stores a large payload out of line in TOAST,
-- so a query selecting just those two columns never detoasts it. `select *` here
-- would make every 60-second poll from every screen in the product pay for a full
-- bundle read to answer "no change".

alter table public.screen_bundles enable row level security;

-- Member select so the dashboard can show build state -- version, built_at, size.
-- No write policies: only the build job writes, with the service role.
create policy "bundles are visible to their org"
  on public.screen_bundles for select to authenticated
  using (public.is_org_member(org_id));

-- One row per screen per hour, not one row per beat. A screen POSTs every 60
-- seconds (plan §3e) and the ingest route upserts into the current hour's bucket.
-- Per beat this table was ~26 million rows a year for fifty screens; bucketed it
-- is ~438,000.
create table public.screen_heartbeats (
  screen_id uuid not null,
  bucket_hour timestamptz not null,
  org_id uuid not null references public.orgs (id) on delete cascade,

  -- Accumulates. An upsert that OVERWRITES this instead of incrementing looks
  -- correct and silently makes the whole table say 1.
  beat_count integer not null default 0 check (beat_count >= 0),
  first_beat_at timestamptz not null default now(),
  last_beat_at timestamptz not null default now(),
  -- Takes the maximum. This is the one thing naive bucketing would destroy:
  -- 41 beats in an hour could be a single 19-minute outage or 19 scattered
  -- misses, and those are different support calls.
  max_gap_seconds integer,

  -- Last reported values.
  bundle_version integer,
  board_id uuid,
  app_version text,
  user_agent text,
  ip inet,
  viewport_width integer,
  viewport_height integer,
  uptime_seconds integer,

  -- Summed over the hour, not last-reported.
  error_count integer not null default 0 check (error_count >= 0),
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (screen_id, bucket_hour),
  constraint screen_heartbeats_screen_fk
    foreign key (screen_id, org_id)
    references public.screens (id, org_id) on delete cascade,
  constraint screen_heartbeats_bucket_is_hour
    check (bucket_hour = date_trunc('hour', bucket_hour))
);

create index screen_heartbeats_org_bucket_idx
  on public.screen_heartbeats (org_id, bucket_hour desc);
-- The retention sweep.
create index screen_heartbeats_bucket_idx on public.screen_heartbeats (bucket_hour);

create trigger screen_heartbeats_set_updated_at
  before update on public.screen_heartbeats
  for each row execute function public.set_updated_at();

alter table public.screen_heartbeats enable row level security;

create policy "heartbeats are visible to their org"
  on public.screen_heartbeats for select to authenticated
  using (public.is_org_member(org_id));

-- No insert policy, and that is not an oversight. The heartbeat comes from
-- /s/[token], which has no session and no auth.uid() to write a policy against.
-- It posts to a server-only route that validates the token and upserts with the
-- service role. A client-writable heartbeat table would let anyone forge liveness
-- for any screen.
--
-- The screens view reads screens.last_seen_at, never this table. This is for
-- history and diagnosis; screens is for the wall of green dots.
