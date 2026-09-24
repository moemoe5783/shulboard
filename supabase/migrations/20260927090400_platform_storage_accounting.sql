-- Storage accounting without double counting.
--
-- platform_orgs().recorded_bytes — what the photo records account for — added
-- each photo's byte_size AND the bytes of every stored size. But the upload
-- keeps no separate original: byte_size is the largest size's own bytes
-- (lib/media/upload.ts), so every photo's biggest file was counted twice, and
-- "left-behind files" on the shul's admin page (storage minus recorded) could
-- read below zero. Each photo now counts its stored sizes once; a row with no
-- sizes listed falls back to byte_size.
--
-- photo_count counts finished photos only: an upload still pending, or one
-- that failed (20260927090100), is not a photo anyone sees in Media.
--
-- storage_bytes and platform_usage() read Storage's own record of each file
-- (storage.objects) and never double counted; they are unchanged.

create or replace function public.platform_orgs()
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
    -- Photos Media shows: live and finished. An upload still pending, or one
    -- that failed, isn't a photo anyone can see.
    (select count(*) from public.assets a where a.org_id = o.id and a.deleted_at is null and a.status = 'ready'),
    coalesce(files.bytes, 0),
    coalesce(files.count, 0),
    -- Each photo's stored sizes, added up. byte_size is not added on top: the
    -- upload keeps no separate original, and byte_size is the largest size's
    -- own bytes (lib/media/upload.ts), so adding it counted that file twice.
    -- A row that lists no sizes at all falls back to byte_size.
    (select coalesce(sum(
        coalesce(
          (select sum((v.value ->> 'bytes')::bigint) from jsonb_each(a.variants) v
            where jsonb_typeof(v.value) = 'object' and v.value ? 'bytes'),
          a.byte_size,
          0)
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

