-- The Storage bucket the media pipeline writes to, and the storage.objects RLS
-- that keeps one shul's files out of another's.
--
-- public.assets (20260904090600_media.sql) protects the METADATA; this protects
-- the BYTES. The media.sql comment calls getting one right and forgetting the
-- other "the most common way a multi-tenant Supabase app leaks files" — this is
-- the other half.
--
-- The display never reads through these policies: /m/<id>/<file> serves bytes
-- with the service role (app/m/[id]/[file]/route.ts), authorized by the path
-- being correct rather than by RLS. These policies are for the dashboard's own
-- authenticated client — the upload writes objects, the album UI reads and
-- deletes them.
--
-- PATH CONVENTION: <org_id>/<asset_id>/<variant>-<hash>.<ext>. The first folder
-- segment is the org id, which is what every policy keys on — the same
-- convention public.assets.storage_path documents.

insert into storage.buckets (id, name, public)
values ('assets', 'assets', false)
on conflict (id) do nothing;

create policy "org members read their asset objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'assets'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "org editors write their asset objects"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assets'
    and public.has_org_role_at_least(((storage.foldername(name))[1])::uuid, 'editor')
  );

create policy "org editors update their asset objects"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'assets'
    and public.has_org_role_at_least(((storage.foldername(name))[1])::uuid, 'editor')
  )
  with check (
    bucket_id = 'assets'
    and public.has_org_role_at_least(((storage.foldername(name))[1])::uuid, 'editor')
  );

create policy "org editors delete their asset objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'assets'
    and public.has_org_role_at_least(((storage.foldername(name))[1])::uuid, 'editor')
  );
