-- Exact storage for the platform admin (the first cut is 20260926090000).
--
-- The shuls list reckoned storage from the photo records — each original and
-- each size made from it. This reads Storage's own record of every file
-- instead (storage.objects, `metadata ->> 'size'`), so it's what the bucket
-- actually holds: including files left behind that no photo points to any
-- more. The record-based figure stays alongside, as `recorded_bytes`, because
-- the gap between the two is exactly those leftovers.
--
-- platform_usage() adds the project-wide numbers: every file in every bucket,
-- the files that belong to no shul, and the database's own size — the two
-- things Supabase meters by size. Supabase bills storage as an average over
-- the month (GB-hours), so these live figures won't match an invoice exactly.
--
-- Both need is_platform_admin(), as before. Reading storage.objects from a
-- SECURITY DEFINER function works because the function runs as its owner,
-- the migration role, which Supabase lets read Storage's tables.

-- The return type grows, which CREATE OR REPLACE can't do.
drop function public.platform_orgs();

create function public.platform_orgs()
returns table (
  org_id uuid,
  name text,
  slug text,
  created_at timestamptz,
  deleted_at timestamptz,
  plan text,
  trial_ends_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  owner_email text,
  member_count bigint,
  screen_count bigint,
  -- Screens that checked in during the last 10 minutes.
  screens_live bigint,
  board_count bigint,
  photo_count bigint,
  -- What the shul's files really take in Storage: every file under its
  -- folder, read from Storage's own record of each file's size — originals,
  -- every size made from them, and anything left behind.
  storage_bytes bigint,
  file_count bigint,
  -- The same as the photo records reckon it, for comparison: a big gap is
  -- files Storage holds that no photo points to.
  recorded_bytes bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    o.name,
    o.slug,
    o.created_at,
    o.deleted_at,
    o.plan,
    o.trial_ends_at,
    o.stripe_customer_id,
    o.stripe_subscription_id,
    (select u.email from public.org_members m join auth.users u on u.id = m.user_id
      where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1),
    (select count(*) from public.org_members m where m.org_id = o.id),
    (select count(*) from public.screens s where s.org_id = o.id),
    (select count(*) from public.screens s where s.org_id = o.id and s.last_seen_at > now() - interval '10 minutes'),
    (select count(*) from public.boards b where b.org_id = o.id and b.deleted_at is null),
    (select count(*) from public.assets a where a.org_id = o.id and a.deleted_at is null),
    coalesce(files.bytes, 0),
    coalesce(files.count, 0),
    (select coalesce(sum(
        coalesce(a.byte_size, 0)
        + coalesce((select sum(coalesce((v.value ->> 'bytes')::bigint, 0)) from jsonb_each(a.variants) v
                      where jsonb_typeof(v.value) = 'object'), 0)
      ), 0)::bigint
      from public.assets a where a.org_id = o.id)
  from public.orgs o
  -- Media's bucket keeps each shul's files under a folder named for its id
  -- (20260923120000_media_storage.sql).
  left join lateral (
    select count(*) as count, sum(coalesce((so.metadata ->> 'size')::bigint, 0))::bigint as bytes
    from storage.objects so
    where so.bucket_id = 'assets' and split_part(so.name, '/', 1) = o.id::text
  ) files on true
  where public.is_platform_admin()
  order by o.created_at desc;
$$;

revoke all on function public.platform_orgs() from public;
grant execute on function public.platform_orgs() to authenticated;

create function public.platform_usage()
returns table (
  storage_bytes bigint,
  file_count bigint,
  -- Files in Storage outside every shul's folder: another bucket, or a
  -- folder for a shul that no longer exists.
  unattributed_bytes bigint,
  database_bytes bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(coalesce((so.metadata ->> 'size')::bigint, 0)), 0)::bigint,
    count(so.id),
    coalesce(sum(coalesce((so.metadata ->> 'size')::bigint, 0)) filter (
      where so.bucket_id <> 'assets'
         or not exists (select 1 from public.orgs o where o.id::text = split_part(so.name, '/', 1))
    ), 0)::bigint,
    pg_database_size(current_database())
  from storage.objects so
  where public.is_platform_admin()
  having public.is_platform_admin();
$$;

revoke all on function public.platform_usage() from public;
grant execute on function public.platform_usage() to authenticated;
