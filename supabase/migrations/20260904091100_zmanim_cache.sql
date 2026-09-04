-- Shared zmanim cache.
--
-- THIS TABLE HAS NO org_id AND IS NOT TENANT-SCOPED. That is deliberate and it is
-- the entire point: twenty Crown Heights shuls resolve to the same location_id, so
-- one API call and one row serves all of them (plan.md §5c). Adding org_id here
-- would multiply MyZmanim's per-location billing by the number of customers in a
-- neighbourhood. CLAUDE.md names this table as the deliberate exception to the
-- tenant-table rule -- do not "fix" it.

create table public.zmanim_cache (
  provider public.zmanim_provider not null,
  -- Provider-namespaced. MyZmanim's internal LocationID; for Hebcal a derived key
  -- such as geo:40.669,-73.943 rounded to fixed precision so that nearby shuls
  -- collide on purpose.
  location_id text not null,
  date date not null,
  timezone text not null,
  -- Canonical zman id -> { "iso": "...", "display": "6:42 pm" }. BOTH. The plan
  -- forbids re-rounding or recomputing provider output, so the provider's own
  -- rendered string is stored verbatim and displayed verbatim; the ISO value
  -- exists for countdowns and sorting only.
  times jsonb not null check (jsonb_typeof(times) = 'object'),
  -- The provider's untouched payload. Worth the bytes: Chabad.org's endpoint is
  -- undocumented and will change shape without notice, and this is the only way
  -- to diagnose it afterwards.
  raw_response jsonb,
  fetched_at timestamptz not null default now(),
  -- Adapter version, so a mapping bug can be identified and those rows re-fetched.
  source_version text,
  primary key (provider, location_id, date)
);

-- The bundle's 90-day read is a range scan on the primary key and needs nothing
-- else. This one is for the pruning job.
create index zmanim_cache_fetched_at_idx on public.zmanim_cache (fetched_at);

alter table public.zmanim_cache enable row level security;

-- Exactly one policy. The select exists so the zmanim settings UI can preview real
-- times while a gabbai is picking rows; there is no write policy at all, so no
-- client can ever write. The cache-warming cron and the bundle builder use the
-- service role, which bypasses RLS.
create policy "cached zmanim are readable by any signed-in user"
  on public.zmanim_cache for select to authenticated
  using (true);
