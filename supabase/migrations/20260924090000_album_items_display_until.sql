-- A photo's last day on screen, per album.
--
-- A gabbai uploads the Purim photos and wants them gone after Purim without
-- remembering to come back and delete them. `display_until` is the last civil
-- date (in the shul's own zone) the photo is shown by a Gallery or Collage
-- bound to this album; after it the photo stays in the album — still in
-- Media, still restorable by clearing the date — but boards skip it.
--
-- ON THE ALBUM ITEM, NOT THE ASSET: the same photo can sit in "Purim 5786"
-- until after Purim and in "Year in pictures" for good. A date, not a
-- timestamp, because that is what a person means by "stop showing it after
-- the 14th", and the display resolves it against the shul's zone offline
-- (widgets/media/albums.ts), so a screen with no network still drops it at
-- the right midnight.
--
-- No new policy: album_items already carries org_id and its four RLS
-- policies (20260904090600_media.sql), which cover this column like any
-- other, and its request_org_rebuild triggers mean a changed date reaches the
-- bundle the same way a changed caption does.

alter table public.album_items
  add column display_until date;

comment on column public.album_items.display_until is
  'Last date (shul time) this photo is shown by boards bound to the album. Null = no end.';
