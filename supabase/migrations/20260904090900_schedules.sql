-- Davening times and shiurim. One row per recurring item ("Shacharis, weekdays,
-- 7:00"), not one row per named schedule.

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  kind public.schedule_kind not null,
  label text not null check (length(btrim(label)) > 0),
  hebrew_label text,
  time_kind public.schedule_time_kind not null default 'fixed',
  fixed_time time,
  -- Canonical zman id (plan §5c). Deliberately unconstrained text: the vocabulary
  -- lives in the widget layer and is shared with zmanim_cache.times and widget
  -- config inside boards.doc.
  zman_id text,
  -- Negative is before. "20 minutes before shkia" is ('shkia', -20).
  zman_offset_minutes integer,
  -- 0 = Sunday. Empty means the item is governed entirely by applies_on.
  days_of_week smallint[] not null default '{}',
  -- Shabbos, yom tov, rosh chodesh, fast days, chol hamoed -- the flags a weekday
  -- array cannot express.
  applies_on jsonb not null default '{}'::jsonb
    check (jsonb_typeof(applies_on) = 'object'),
  effective_from date,
  effective_to date,
  location_note text,
  position numeric not null default 0,
  is_active boolean not null default true,
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Exactly one time shape, enforced.
  constraint schedules_time_shape check (
    (time_kind = 'fixed' and fixed_time is not null and zman_id is null)
    or (time_kind = 'zman_relative' and zman_id is not null and fixed_time is null)
  ),
  constraint schedules_days_of_week_range check (
    days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  constraint schedules_effective_range check (
    effective_from is null or effective_to is null or effective_to >= effective_from
  )
);

-- The widget read path.
create index schedules_widget_idx
  on public.schedules (org_id, kind, position) where is_active;
create index schedules_effective_idx
  on public.schedules (org_id, effective_from, effective_to);

create trigger schedules_set_updated_at
  before update on public.schedules
  for each row execute function public.set_updated_at();

alter table public.schedules enable row level security;

create policy "schedules are visible to their org"
  on public.schedules for select to authenticated
  using (public.is_org_member(org_id));

create policy "schedules are created by editors"
  on public.schedules for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "schedules are updated by editors"
  on public.schedules for update to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'))
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "schedules are deleted by editors"
  on public.schedules for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'));
