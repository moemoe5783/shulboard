-- Bundle invalidation.
--
-- INVALIDATION IS ORG-WIDE. ANY CONTENT CHANGE MARKS EVERY SCREEN IN THAT ORG FOR
-- REBUILD. THIS IS DELIBERATE. DO NOT OPTIMIZE IT.
--
-- The precise version of this is a graph walk: announcement -> which widgets read
-- announcements -> which board documents contain those widgets -> which playlist
-- items schedule those boards -> which playlists -> which screens. It is correct
-- in principle and wrong in practice, for three reasons.
--
--   1. Every new widget adds an edge. The graph grows with the widget registry,
--      and adding widget #26 is supposed to mean creating one folder and nothing
--      else (plan.md §5). A traversal makes it mean creating one folder and
--      remembering to update this file.
--   2. A missed edge is invisible. Over-invalidating costs a rebuild.
--      Under-invalidating means a screen in a lobby shows last week's davening
--      times and nothing anywhere reports an error -- the exact failure the whole
--      offline design in plan.md §3 exists to prevent, discovered by a member of
--      the shul rather than by monitoring.
--   3. Half the edges are not in the database anyway. With the board document in
--      jsonb, "which widgets read announcements" is a property of the widget
--      manifests in the codebase, not of a foreign key.
--
-- Over-invalidation is nearly free because the build job hashes the payload and
-- compares it to the stored content_hash. A rebuild that produces identical
-- content updates built_at and stops: version does not move, payload is not
-- rewritten, and no screen refetches or cross-fades. The expensive thing to get
-- wrong was never the rebuild, it was the refetch.
--
-- SECURITY DEFINER because an editor updating an announcement has no write access
-- to screens, which is admin-only.
--
-- Statement-level with transition tables so a bulk write is one UPDATE over the
-- org's screens rather than one per affected row.
create function public.request_org_rebuild()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.screens s
       set rebuild_requested_at = now()
     where s.org_id in (select n.org_id from new_rows n);
  elsif tg_op = 'UPDATE' then
    update public.screens s
       set rebuild_requested_at = now()
     where s.org_id in (
       select n.org_id from new_rows n
       union
       select o.org_id from old_rows o
     );
  else
    update public.screens s
       set rebuild_requested_at = now()
     where s.org_id in (select o.org_id from old_rows o);
  end if;
  return null;
end;
$$;

-- Adding a new content table means adding these three triggers. Their absence is
-- the only way to reintroduce staleness.
create trigger announcements_request_rebuild_ins
  after insert on public.announcements
  referencing new table as new_rows
  for each statement execute function public.request_org_rebuild();
create trigger announcements_request_rebuild_upd
  after update on public.announcements
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.request_org_rebuild();
create trigger announcements_request_rebuild_del
  after delete on public.announcements
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild();

create trigger schedules_request_rebuild_ins
  after insert on public.schedules
  referencing new table as new_rows
  for each statement execute function public.request_org_rebuild();
create trigger schedules_request_rebuild_upd
  after update on public.schedules
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.request_org_rebuild();
create trigger schedules_request_rebuild_del
  after delete on public.schedules
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild();

create trigger people_request_rebuild_ins
  after insert on public.people
  referencing new table as new_rows
  for each statement execute function public.request_org_rebuild();
create trigger people_request_rebuild_upd
  after update on public.people
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.request_org_rebuild();
create trigger people_request_rebuild_del
  after delete on public.people
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild();

create trigger boards_request_rebuild_ins
  after insert on public.boards
  referencing new table as new_rows
  for each statement execute function public.request_org_rebuild();
create trigger boards_request_rebuild_upd
  after update on public.boards
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.request_org_rebuild();
create trigger boards_request_rebuild_del
  after delete on public.boards
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild();

create trigger playlists_request_rebuild_ins
  after insert on public.playlists
  referencing new table as new_rows
  for each statement execute function public.request_org_rebuild();
create trigger playlists_request_rebuild_upd
  after update on public.playlists
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.request_org_rebuild();
create trigger playlists_request_rebuild_del
  after delete on public.playlists
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild();

create trigger playlist_items_request_rebuild_ins
  after insert on public.playlist_items
  referencing new table as new_rows
  for each statement execute function public.request_org_rebuild();
create trigger playlist_items_request_rebuild_upd
  after update on public.playlist_items
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.request_org_rebuild();
create trigger playlist_items_request_rebuild_del
  after delete on public.playlist_items
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild();

create trigger albums_request_rebuild_ins
  after insert on public.albums
  referencing new table as new_rows
  for each statement execute function public.request_org_rebuild();
create trigger albums_request_rebuild_upd
  after update on public.albums
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.request_org_rebuild();
create trigger albums_request_rebuild_del
  after delete on public.albums
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild();

create trigger album_items_request_rebuild_ins
  after insert on public.album_items
  referencing new table as new_rows
  for each statement execute function public.request_org_rebuild();
create trigger album_items_request_rebuild_upd
  after update on public.album_items
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.request_org_rebuild();
create trigger album_items_request_rebuild_del
  after delete on public.album_items
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild();

create trigger assets_request_rebuild_ins
  after insert on public.assets
  referencing new table as new_rows
  for each statement execute function public.request_org_rebuild();
create trigger assets_request_rebuild_upd
  after update on public.assets
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.request_org_rebuild();
create trigger assets_request_rebuild_del
  after delete on public.assets
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild();

create trigger calendar_events_request_rebuild_ins
  after insert on public.calendar_events
  referencing new table as new_rows
  for each statement execute function public.request_org_rebuild();
create trigger calendar_events_request_rebuild_upd
  after update on public.calendar_events
  referencing new table as new_rows old table as old_rows
  for each statement execute function public.request_org_rebuild();
create trigger calendar_events_request_rebuild_del
  after delete on public.calendar_events
  referencing old table as old_rows
  for each statement execute function public.request_org_rebuild();

-- orgs and screens need UPDATE triggers restricted to the columns that actually
-- change what a bundle contains, and Postgres does not allow transition tables on
-- a trigger with a column list. These two are therefore row-level with a WHEN
-- guard, which is equivalent here because orgs and screens are edited one row at a
-- time by a person, never in bulk.
--
-- The guard is not optional on screens. That table's rebuild_* and last_seen_*
-- columns are written constantly by the build worker and the heartbeat route, and
-- an unguarded trigger would recurse: setting rebuild_requested_at would fire the
-- trigger that sets rebuild_requested_at. The WHEN clause lists only content
-- columns, so the worker's own writes never re-fire it.
--
-- New screens need no insert trigger: screens.rebuild_requested_at defaults to
-- now(), so a new screen is already queued for its first build.
create function public.request_org_rebuild_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 'id' for orgs, whose own id is the org id; 'org_id' everywhere else.
  col text := coalesce(tg_argv[0], 'org_id');
  target uuid;
begin
  if tg_op = 'DELETE' then
    target := (to_jsonb(old) ->> col)::uuid;
  else
    target := (to_jsonb(new) ->> col)::uuid;
  end if;

  update public.screens s
     set rebuild_requested_at = now()
   where s.org_id = target;

  return null;
end;
$$;

create trigger orgs_request_rebuild_upd
  after update on public.orgs
  for each row
  when (
    old.name is distinct from new.name
    or old.theme is distinct from new.theme
    or old.hebrew_prefs is distinct from new.hebrew_prefs
    or old.nusach is distinct from new.nusach
    or old.timezone is distinct from new.timezone
    or old.latitude is distinct from new.latitude
    or old.longitude is distinct from new.longitude
    or old.elevation_m is distinct from new.elevation_m
    or old.postal_code is distinct from new.postal_code
    or old.zmanim_provider is distinct from new.zmanim_provider
    or old.myzmanim_location_id is distinct from new.myzmanim_location_id
  )
  execute function public.request_org_rebuild_row('id');

create trigger screens_request_rebuild_upd
  after update on public.screens
  for each row
  when (
    old.name is distinct from new.name
    or old.location_note is distinct from new.location_note
    or old.token is distinct from new.token
    or old.playlist_id is distinct from new.playlist_id
    or old.orientation is distinct from new.orientation
    or old.canvas_width is distinct from new.canvas_width
    or old.canvas_height is distinct from new.canvas_height
    or old.timezone is distinct from new.timezone
    or old.latitude is distinct from new.latitude
    or old.longitude is distinct from new.longitude
    or old.elevation_m is distinct from new.elevation_m
    or old.postal_code is distinct from new.postal_code
    or old.zmanim_provider is distinct from new.zmanim_provider
    or old.zmanim_location_id is distinct from new.zmanim_location_id
    or old.hebrew_prefs is distinct from new.hebrew_prefs
    or old.is_active is distinct from new.is_active
  )
  execute function public.request_org_rebuild_row('org_id');
