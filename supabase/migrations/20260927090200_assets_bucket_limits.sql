-- What the `assets` bucket accepts: the two types the upload writes, at most
-- 8 MB each.
--
-- The upload (lib/media/upload.ts) only ever stores WebP, or JPEG when the
-- browser can't encode WebP, and a 2160px photo is well under a megabyte. Until
-- now that was a promise the browser code made; any editor's session could
-- put any file of any size in its shul's folder through the Storage API
-- directly. Storage enforces these itself, so the promise now holds whoever
-- calls. lib/media/variants.ts carries the same two values for the browser's
-- own check — change them together.

update storage.buckets
   set allowed_mime_types = array['image/webp', 'image/jpeg'],
       file_size_limit = 8388608
 where id = 'assets';
