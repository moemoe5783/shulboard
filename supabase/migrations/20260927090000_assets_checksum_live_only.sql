-- A deleted photo can be uploaded again.
--
-- assets_org_checksum_key (20260904090600_media.sql) made a checksum unique per
-- shul across every row, deleted ones included. The upload's dedup lookup
-- (lib/media/upload.ts) only looks at live rows, so re-uploading a photo that
-- had been deleted found nothing to reuse, then hit the index on insert and
-- failed with "Couldn't save …" — with no way in Media to see why.
--
-- Uniqueness now covers live rows only, which is what dedup means: one live
-- asset per file per shul. A soft-deleted row keeps its checksum, so a later
-- restore has to check for a live duplicate first; nothing restores yet.

drop index public.assets_org_checksum_key;

create unique index assets_org_checksum_key
  on public.assets (org_id, checksum_sha256)
  where checksum_sha256 is not null and deleted_at is null;
