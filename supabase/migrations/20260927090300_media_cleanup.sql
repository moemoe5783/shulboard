-- Media cleanup: hard deletes that don't wake every screen, and the two lookups
-- the cleanup job (app/api/cron/clean-media) needs that no RLS policy can
-- express.
--
-- ---------------------------------------------------------------------------
-- 1. Hard deletes of rows no screen shows don't queue rebuilds
-- ---------------------------------------------------------------------------
--
-- request_org_rebuild() (20260904091400) queues every screen in the org on any
-- delete from assets, album_items or albums. Deleting a photo that was already
-- soft-deleted — which is all the cleanup job and the "Delete permanently"
-- button ever do — changes nothing a screen shows: the bundle already left it
-- out. Rebuilding every screen of every shul whose trash was emptied tonight
-- would be a storm of builds for nothing. So these three delete triggers now
-- count only rows a bundle could have included:
--
--   assets       live (deleted_at is null) and ready
--   album_items  whose photo is still a live, ready row and whose album is
--                live. A link removed because its photo or album is being
--                deleted (the FK cascade, or the purge's own tidy-up) finds
--                that parent gone or deleted and is skipped.
--   albums       live
--
-- Inserts and updates are untouched: soft-deleting is an update, and still
-- rebuilds, which is what takes a photo off the wall.

create function public.request_org_rebuild_assets_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.screens s
     set rebuild_requested_at = now()
   where s.org_id in (
     select o.org_id from old_rows o where o.deleted_at is null and o.status = 'ready'
   );
  return null;
end;
$$;

create function public.request_org_rebuild_album_items_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.screens s
     set rebuild_requested_at = now()
   where s.org_id in (
     select o.org_id
       from old_rows o
       join public.assets a on a.id = o.asset_id
       join public.albums al on al.id = o.album_id
      where a.deleted_at is null and a.status = 'ready' and al.deleted_at is null
   );
  return null;
end;
$$;

create function public.request_org_rebuild_albums_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.screens s
     set rebuild_requested_at = now()
   where s.org_id in (select o.org_id from old_rows o where o.deleted_at is null);
  return null;
end;
$$;

drop trigger assets_request_rebuild_del on public.assets;
create trigger assets_request_rebuild_del
  after delete on public.assets
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild_assets_deleted();

drop trigger album_items_request_rebuild_del on public.album_items;
create trigger album_items_request_rebuild_del
  after delete on public.album_items
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild_album_items_deleted();

drop trigger albums_request_rebuild_del on public.albums;
create trigger albums_request_rebuild_del
  after delete on public.albums
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild_albums_deleted();

-- ---------------------------------------------------------------------------
-- 2. Which trashed photos are due, and which a board still points at
-- ---------------------------------------------------------------------------
--
-- A photo deleted more than p_retention_days ago is due for permanent
-- deletion unless a live board's document (draft or published) or a screen's
-- current bundle still names its id. Those are kept, and returned with the
-- boards that name them so the job can report them — a board pointing at a
-- deleted photo shows the widget's empty state, and permanently deleting the
-- photo would make "restore it" impossible for the shul that notices.
--
-- Its album links don't count: a soft-deleted photo keeps them on purpose, so
-- restoring it puts it back where it was (app/(app)/media/trash-actions.ts).
--
-- The id is matched as text anywhere in the documents, so every way a board
-- can name a photo — an Image widget's assetId, a background's value, a /m
-- path — counts without this function knowing the document shape.
--
-- Returns up to p_limit due photos AND up to p_limit kept ones, so a shul with
-- a hundred kept photos can't starve the due ones out of the batch.
-- Service role only: it reads every shul at once.

create function public.media_purge_candidates(p_retention_days integer, p_limit integer)
returns table (
  asset_id uuid,
  org_id uuid,
  deleted_at timestamptz,
  referenced boolean,
  boards jsonb,
  in_bundle boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with due as (
    select a.id, a.org_id, a.deleted_at,
      (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name), '[]'::jsonb)
         from public.boards b
        where b.org_id = a.org_id
          and b.deleted_at is null
          and (strpos(b.doc::text, a.id::text) > 0
            or strpos(coalesce(b.published_doc::text, ''), a.id::text) > 0)) as boards,
      exists (select 1 from public.screen_bundles sb
               where sb.org_id = a.org_id and strpos(sb.payload::text, a.id::text) > 0) as in_bundle
      from public.assets a
     where a.deleted_at is not null
       and a.deleted_at < now() - make_interval(days => p_retention_days)
  ),
  classified as (
    select d.*, (jsonb_array_length(d.boards) > 0 or d.in_bundle) as referenced from due d
  )
  (select c.id, c.org_id, c.deleted_at, false, c.boards, c.in_bundle
     from classified c where not c.referenced order by c.deleted_at limit p_limit)
  union all
  (select c.id, c.org_id, c.deleted_at, true, c.boards, c.in_bundle
     from classified c where c.referenced order by c.deleted_at limit p_limit);
$$;

-- ---------------------------------------------------------------------------
-- 3. Files in the bucket that no photo row claims
-- ---------------------------------------------------------------------------
--
-- Path convention (20260923120000_media_storage.sql):
-- <org_id>/<asset_id>/<variant>-<hash>.<ext>. A file whose second segment is
-- no assets row at all — deleted or not — belongs to nothing: an upload whose
-- row never got written, or a row removed some other way. Only files older
-- than p_min_age_hours, so an upload in progress right now is never touched.
-- Service role only.

create function public.media_orphan_objects(p_min_age_hours integer, p_limit integer)
returns table (name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select so.name, so.created_at
    from storage.objects so
   where so.bucket_id = 'assets'
     and so.created_at < now() - make_interval(hours => p_min_age_hours)
     and not exists (
       select 1 from public.assets a where a.id::text = split_part(so.name, '/', 2)
     )
   order by so.created_at
   limit p_limit;
$$;

revoke all on function public.media_purge_candidates(integer, integer) from public, anon, authenticated;
revoke all on function public.media_orphan_objects(integer, integer) from public, anon, authenticated;
grant execute on function public.media_purge_candidates(integer, integer) to service_role;
grant execute on function public.media_orphan_objects(integer, integer) to service_role;
