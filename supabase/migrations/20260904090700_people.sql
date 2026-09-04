-- People: birthdays and yahrzeits, with Hebrew and Gregorian dates for each.
--
-- The Hebrew date is structured rather than a formatted string because the
-- yahrzeit lookahead filters on month and day. A text column reading '23 Elul'
-- cannot be indexed usefully for "everyone in the next 60 days".

create table public.people (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  first_name text,
  last_name text,
  -- Explicit, not computed: "R' Yosef Cohen" is not derivable from the parts.
  display_name text not null check (length(btrim(display_name)) > 0),
  hebrew_name text,
  father_hebrew_name text,
  mother_hebrew_name text,
  -- Drives ben/bat construction and Hebrew grammar only.
  gender public.person_gender not null default 'unspecified',

  birth_date_gregorian date,
  birth_hebrew_year integer,
  -- Named, not numbered: numeric Hebrew months are ambiguous across leap years.
  birth_hebrew_month text check (birth_hebrew_month is null or birth_hebrew_month in (
    'nisan', 'iyar', 'sivan', 'tammuz', 'av', 'elul', 'tishrei', 'cheshvan',
    'kislev', 'teves', 'shevat', 'adar', 'adar_i', 'adar_ii')),
  birth_hebrew_day smallint check (birth_hebrew_day is null or birth_hebrew_day between 1 and 30),
  birth_after_sunset boolean not null default false,

  death_date_gregorian date,
  death_hebrew_year integer,
  death_hebrew_month text check (death_hebrew_month is null or death_hebrew_month in (
    'nisan', 'iyar', 'sivan', 'tammuz', 'av', 'elul', 'tishrei', 'cheshvan',
    'kislev', 'teves', 'shevat', 'adar', 'adar_i', 'adar_ii')),
  death_hebrew_day smallint check (death_hebrew_day is null or death_hebrew_day between 1 and 30),
  -- Not optional: the sunset-of-death question moves the yahrzeit by a day.
  death_after_sunset boolean not null default false,
  -- Some hold the first yahrzeit follows burial, not death.
  burial_date_gregorian date,
  yahrzeit_first_year_rule text
    check (yahrzeit_first_year_rule is null or yahrzeit_first_year_rule in ('death', 'burial')),

  -- What the board prints under a yahrzeit: "The Cohen family".
  commemorated_by text,
  photo_asset_id uuid,
  show_on_boards boolean not null default true,
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint people_id_org_key unique (id, org_id),
  constraint people_photo_asset_fk
    foreign key (photo_asset_id, org_id)
    references public.assets (id, org_id) on delete set null,

  -- A person row with no date is a contact, not a bulletin-board entry.
  constraint people_has_some_date check (
    birth_date_gregorian is not null
    or birth_hebrew_day is not null
    or death_date_gregorian is not null
    or death_hebrew_day is not null
  ),
  -- The Hebrew triple is all-or-nothing, for each of birth and death.
  constraint people_birth_hebrew_complete check (
    num_nulls(birth_hebrew_year, birth_hebrew_month, birth_hebrew_day) in (0, 3)
  ),
  constraint people_death_hebrew_complete check (
    num_nulls(death_hebrew_year, death_hebrew_month, death_hebrew_day) in (0, 3)
  )
);

-- The yahrzeit and birthday lookaheads.
create index people_yahrzeit_idx
  on public.people (org_id, death_hebrew_month, death_hebrew_day)
  where death_hebrew_day is not null;
create index people_hebrew_birthday_idx
  on public.people (org_id, birth_hebrew_month, birth_hebrew_day)
  where birth_hebrew_day is not null;
create index people_gregorian_birthday_idx
  on public.people (org_id, birth_date_gregorian)
  where birth_date_gregorian is not null;
create index people_org_idx on public.people (org_id) where deleted_at is null;

create trigger people_set_updated_at
  before update on public.people
  for each row execute function public.set_updated_at();

alter table public.people enable row level security;

create policy "people are visible to their org"
  on public.people for select to authenticated
  using (public.is_org_member(org_id));

create policy "people are created by editors"
  on public.people for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "people are updated by editors"
  on public.people for update to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'))
  with check (public.has_org_role_at_least(org_id, 'editor'));

-- Delete is admin here, unlike the other content tables. This is the one table
-- holding family and death records, and a mis-click is not recoverable from a
-- gabbai's memory.
create policy "people are deleted by admins"
  on public.people for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'));
