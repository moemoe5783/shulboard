-- A failed upload doesn't block trying the same photo again.
--
-- The upload now writes its assets row FIRST, as 'pending', and only marks it
-- 'ready' once every size is in Storage (lib/media/upload.ts). A row that
-- failed keeps its checksum — the cleanup job (app/api/cron/clean-media) reads
-- it to find and remove the row's files — so the dedup index has to skip it,
-- or the gabbai's retry would hit "duplicate key" on a photo that was never
-- saved. A 'pending' row still counts: that is a second tab uploading the
-- same file right now, and one of them should win.

drop index public.assets_org_checksum_key;

create unique index assets_org_checksum_key
  on public.assets (org_id, checksum_sha256)
  where checksum_sha256 is not null and deleted_at is null and status <> 'failed';
