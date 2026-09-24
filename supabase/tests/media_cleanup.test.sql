-- Media cleanup: hard deletes of already-hidden rows don't queue rebuilds, and
-- the cleanup job's two lookups (20260927090300_media_cleanup.sql).
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

reset role;

insert into public.screens (id, org_id, name, token)
values ('5c000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
        'Main lobby', 'abcdefghijkmnpqrstuvwxyz23456789');

insert into public.albums (id, org_id, name)
values ('ab000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001', 'Kiddush');

-- live: on the wall. old: trashed 40 days ago. board: trashed 40 days ago but
-- a board names it. recent: trashed yesterday. failed: an upload that failed.
insert into public.assets (id, org_id, kind, storage_path, mime_type, status, deleted_at) values
  ('a5000000-0000-4000-8000-00000000000a', '0e000000-0000-4000-8000-000000000001', 'image', 'p', 'image/webp', 'ready', null),
  ('a5000000-0000-4000-8000-00000000000b', '0e000000-0000-4000-8000-000000000001', 'image', 'p', 'image/webp', 'ready', now() - interval '40 days'),
  ('a5000000-0000-4000-8000-00000000000c', '0e000000-0000-4000-8000-000000000001', 'image', 'p', 'image/webp', 'ready', now() - interval '40 days'),
  ('a5000000-0000-4000-8000-00000000000d', '0e000000-0000-4000-8000-000000000001', 'image', 'p', 'image/webp', 'ready', now() - interval '1 day'),
  ('a5000000-0000-4000-8000-00000000000e', '0e000000-0000-4000-8000-000000000001', 'image', 'p', 'image/webp', 'failed', null);

insert into public.album_items (org_id, album_id, asset_id, position) values
  ('0e000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-00000000000a', 1),
  ('0e000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-00000000000b', 2);

insert into public.boards (id, org_id, name, doc)
values ('b0000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001', 'Weekday board',
        '{"widgets":[{"type":"image","config":{"assetId":"a5000000-0000-4000-8000-00000000000c"}}]}');

create function pg_temp.queued() returns boolean language sql as $$
  select rebuild_requested_at is not null from public.screens where id = '5c000000-0000-4000-8000-000000000001';
$$;
create function pg_temp.clear() returns void language sql as $$
  update public.screens set rebuild_requested_at = null where id = '5c000000-0000-4000-8000-000000000001';
$$;

set local role service_role;

-- ---------------------------------------------------------------------------
-- Rebuilds: only for rows a screen could show
-- ---------------------------------------------------------------------------

select pg_temp.clear();
delete from public.album_items where asset_id = 'a5000000-0000-4000-8000-00000000000b';
delete from public.assets where id = 'a5000000-0000-4000-8000-00000000000b';
select tests.ok(not pg_temp.queued(), 'rebuild: purging a trashed photo and its album link queues nothing');

select pg_temp.clear();
delete from public.assets where id = 'a5000000-0000-4000-8000-00000000000e';
select tests.ok(not pg_temp.queued(), 'rebuild: deleting a failed upload queues nothing');

select pg_temp.clear();
delete from public.album_items where asset_id = 'a5000000-0000-4000-8000-00000000000a';
select tests.ok(pg_temp.queued(), 'rebuild: taking a live photo out of a live album still rebuilds');

select pg_temp.clear();
delete from public.assets where id = 'a5000000-0000-4000-8000-00000000000a';
select tests.ok(pg_temp.queued(), 'rebuild: hard-deleting a live photo still rebuilds');

select pg_temp.clear();
update public.albums set deleted_at = now() where id = 'ab000000-0000-4000-8000-000000000001';
select tests.ok(pg_temp.queued(), 'rebuild: soft-deleting an album still rebuilds');
select pg_temp.clear();
delete from public.albums where id = 'ab000000-0000-4000-8000-000000000001';
select tests.ok(not pg_temp.queued(), 'rebuild: purging an album already in the trash queues nothing');

-- ---------------------------------------------------------------------------
-- Which trashed photos are due
-- ---------------------------------------------------------------------------

insert into public.assets (id, org_id, kind, storage_path, mime_type, status, deleted_at) values
  ('a5000000-0000-4000-8000-00000000000f', '0e000000-0000-4000-8000-000000000001', 'image', 'p', 'image/webp', 'ready', now() - interval '31 days');

select tests.eq(
  (select count(*) from public.media_purge_candidates(30, 50) where not referenced),
  1, 'purge: exactly the unreferenced photo trashed over 30 days ago is due');
select tests.ok(
  (select asset_id = 'a5000000-0000-4000-8000-00000000000f' from public.media_purge_candidates(30, 50) where not referenced),
  'purge: and it is the right one');
select tests.ok(
  (select boards = '[{"id": "b0000000-0000-4000-8000-000000000001", "name": "Weekday board"}]'::jsonb
     from public.media_purge_candidates(30, 50)
    where referenced and asset_id = 'a5000000-0000-4000-8000-00000000000c'),
  'purge: a photo a board names is kept, reported with the board');
select tests.ok(
  not exists (select 1 from public.media_purge_candidates(30, 50) where asset_id = 'a5000000-0000-4000-8000-00000000000d'),
  'purge: a photo trashed yesterday is not due');
select tests.eq(
  (select count(*) from public.media_purge_candidates(30, 0) where not referenced),
  0, 'purge: the batch limit holds');

update public.boards set deleted_at = now() where id = 'b0000000-0000-4000-8000-000000000001';
select tests.ok(
  (select not referenced from public.media_purge_candidates(30, 50) where asset_id = 'a5000000-0000-4000-8000-00000000000c'),
  'purge: a deleted board no longer keeps a photo');

-- ---------------------------------------------------------------------------
-- Files nothing claims
-- ---------------------------------------------------------------------------

reset role;
insert into storage.objects (bucket_id, name, created_at) values
  ('assets', '0e000000-0000-4000-8000-000000000001/a5000000-0000-4000-8000-00000000000c/display-1.webp', now() - interval '3 days'),
  ('assets', '0e000000-0000-4000-8000-000000000001/a5000000-0000-4000-8000-0000000000ff/display-1.webp', now() - interval '3 days'),
  ('assets', '0e000000-0000-4000-8000-000000000001/a5000000-0000-4000-8000-0000000000fe/display-1.webp', now() - interval '1 hour'),
  ('assets', '0e000000-0000-4000-8000-000000000001/not-a-uuid/display-1.webp', now() - interval '3 days');
set local role service_role;

select tests.ok(
  (select array_agg(name order by name) from public.media_orphan_objects(24, 50)) = array[
    '0e000000-0000-4000-8000-000000000001/a5000000-0000-4000-8000-0000000000ff/display-1.webp',
    '0e000000-0000-4000-8000-000000000001/not-a-uuid/display-1.webp'],
  'orphans: old files with no photo row are found; a claimed file and a new one are not');

-- ---------------------------------------------------------------------------
-- Nobody else can call them
-- ---------------------------------------------------------------------------

reset role;
select tests.authenticate_as('a1111111-1111-4111-8111-111111111111');
set local role authenticated;
select tests.denied($$select * from public.media_purge_candidates(30, 50)$$,
  'grants: an editor cannot list every shul''s trash');
select tests.denied($$select * from public.media_orphan_objects(24, 50)$$,
  'grants: an editor cannot list every shul''s files');

reset role;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from tests.log;

rollback;
