-- Enum types and the shared trigger helpers every later migration depends on.
-- Nothing in this migration is tenant-scoped, so nothing here has RLS.

-- org_role is declared in ascending privilege order on purpose: Postgres orders
-- enum values by declaration order, so `role >= 'editor'` is a rank comparison
-- and has_org_role_at_least() is a one-line function instead of a CASE ladder.
-- Do not reorder these values and do not insert a new one in the middle without
-- reading has_org_role_at_least() first.
create type public.org_role as enum ('viewer', 'editor', 'admin', 'owner');

-- All four values exist from the first migration even though v1 only ever writes
-- 'manual' (plan.md §6). Widgets bind to albums and never learn where photos came
-- from, so adding Drive sync later is a worker plus a settings panel, not a data
-- migration.
create type public.album_source as enum ('manual', 'drive', 'photos_import', 'email');

create type public.asset_kind as enum ('image', 'video');
create type public.asset_status as enum ('pending', 'processing', 'ready', 'failed');
create type public.moderation_status as enum ('approved', 'pending', 'rejected');
create type public.zmanim_provider as enum ('hebcal', 'chabad', 'myzmanim', 'manual');
create type public.nusach as enum ('ashkenaz', 'sefard', 'ari', 'edot_hamizrach');
create type public.screen_orientation as enum ('landscape', 'portrait');
create type public.announcement_status as enum ('draft', 'published', 'archived');
create type public.schedule_kind as enum ('davening', 'shiur', 'other');
create type public.schedule_time_kind as enum ('fixed', 'zman_relative');
create type public.calendar_provider as enum ('google');
create type public.calendar_event_status as enum ('confirmed', 'tentative', 'cancelled');
create type public.sync_status as enum ('never', 'ok', 'error');
create type public.person_gender as enum ('male', 'female', 'unspecified');
create type public.upload_source as enum ('dashboard', 'share_link');
create type public.audit_actor_kind as enum ('user', 'system', 'share_link');

-- Application-maintained timestamps drift the moment anything writes outside the
-- app -- a migration, a support query, the sync worker. This trigger is attached
-- to every table carrying updated_at.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
