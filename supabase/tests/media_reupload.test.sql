-- Media: a photo that was deleted can be uploaded again.
--
-- Walks the same writes lib/media/upload.ts makes, as an editor under RLS:
-- dedup lookup, insert, soft delete (app/(app)/media/actions.ts), then the
-- same file again.
--
-- Run with: npm run test:db

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

begin;

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'gabbai@example.test');

select tests.authenticate_as('a1111111-1111-4111-8111-111111111111');
set local role authenticated;

insert into public.orgs (id, name, slug, timezone, created_by)
values ('0e000000-0000-4000-8000-000000000001', 'Beis Menachem', 'beis-menachem', 'UTC',
        'a1111111-1111-4111-8111-111111111111');

insert into public.assets (id, org_id, kind, storage_path, mime_type, checksum_sha256, status)
values ('a5000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
        'image', '0e000000-0000-4000-8000-000000000001/a5000000-0000-4000-8000-000000000001/large-aaaa.webp',
        'image/webp', 'same-file', 'ready');

-- A second live copy of the same file is still refused: that's the dedup.
do $$
begin
  insert into public.assets (id, org_id, kind, storage_path, mime_type, checksum_sha256, status)
  values ('a5000000-0000-4000-8000-000000000002', '0e000000-0000-4000-8000-000000000001',
          'image', 'x', 'image/webp', 'same-file', 'ready');
  perform tests.fail('reupload: a second live asset with the same checksum was allowed');
exception when unique_violation then
  perform tests.pass('reupload: a second live asset with the same checksum is refused');
end $$;

-- Delete it the way Media does.
update public.assets set deleted_at = now() where id = 'a5000000-0000-4000-8000-000000000001';

-- The upload's dedup lookup sees nothing live…
select tests.eq(
  (select count(*) from public.assets
    where org_id = '0e000000-0000-4000-8000-000000000001'
      and checksum_sha256 = 'same-file' and deleted_at is null),
  0, 'reupload: the dedup lookup finds no live asset after a delete');

-- …so it inserts, and that now succeeds as a new live asset.
select tests.allowed($$
  insert into public.assets (id, org_id, kind, storage_path, mime_type, checksum_sha256, status)
  values ('a5000000-0000-4000-8000-000000000003', '0e000000-0000-4000-8000-000000000001',
          'image', 'y', 'image/webp', 'same-file', 'ready')
$$, 'reupload: the same file uploads again after its asset was deleted');

select tests.eq(
  (select count(*) from public.assets
    where checksum_sha256 = 'same-file' and deleted_at is null),
  1, 'reupload: exactly one live asset for the file');

select tests.eq(
  (select count(*) from public.assets where checksum_sha256 = 'same-file'),
  2, 'reupload: the deleted row is kept alongside it');

-- ---------------------------------------------------------------------------
-- A failed upload doesn't hold the checksum; one in progress does.
-- ---------------------------------------------------------------------------

insert into public.assets (id, org_id, kind, storage_path, mime_type, checksum_sha256, status)
values ('a5000000-0000-4000-8000-000000000004', '0e000000-0000-4000-8000-000000000001',
        'image', '0e000000-0000-4000-8000-000000000001/a5000000-0000-4000-8000-000000000004/',
        'image/webp', 'second-file', 'pending');

do $$
begin
  insert into public.assets (id, org_id, kind, storage_path, mime_type, checksum_sha256, status)
  values ('a5000000-0000-4000-8000-000000000005', '0e000000-0000-4000-8000-000000000001',
          'image', 'z', 'image/webp', 'second-file', 'pending');
  perform tests.fail('reupload: a second upload of a file already in progress was allowed');
exception when unique_violation then
  perform tests.pass('reupload: a file already uploading holds its checksum');
end $$;

update public.assets set status = 'failed', processing_error = 'Upload failed'
 where id = 'a5000000-0000-4000-8000-000000000004';

select tests.allowed($$
  insert into public.assets (id, org_id, kind, storage_path, mime_type, checksum_sha256, status)
  values ('a5000000-0000-4000-8000-000000000005', '0e000000-0000-4000-8000-000000000001',
          'image', 'z', 'image/webp', 'second-file', 'pending')
$$, 'reupload: a file whose upload failed can be tried again');

-- ---------------------------------------------------------------------------
-- The bucket's own limits (20260927090200_assets_bucket_limits.sql)
-- ---------------------------------------------------------------------------

reset role;
select tests.ok(
  (select allowed_mime_types = array['image/webp', 'image/jpeg'] from storage.buckets where id = 'assets'),
  'bucket: assets accepts WebP and JPEG only');
select tests.eq(
  (select file_size_limit from storage.buckets where id = 'assets'),
  8388608, 'bucket: assets caps a file at 8 MB');

reset role;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from tests.log;

rollback;
