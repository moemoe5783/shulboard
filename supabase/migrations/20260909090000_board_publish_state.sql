-- Draft and published states for boards.
--
-- `doc` stays the draft: what the editor's autosave writes, what a gabbai is
-- actively shaping. `published_doc` is what a screen actually shows, and it
-- only ever changes when someone explicitly publishes. Nothing an editor does
-- to `doc` reaches a screen until that happens -- see the trigger fix below,
-- which is the other half of making that true.

alter table public.boards
  -- What screens actually show, through lib/bundle/build.ts. Written only by
  -- the publish action (app/(editor)/boards/[id]/actions.ts) -- never by
  -- autosave. Null means this board has never been published, and
  -- contributes nothing to any bundle.
  add column published_doc jsonb,
  -- When publish last ran. Null means never published -- a distinct state
  -- from "published, with the draft since edited," and the editor and boards
  -- list say so differently.
  add column published_at timestamptz,
  -- Who last published. Set from the acting user in the publish action, not a
  -- trigger, so it names a person rather than "system."
  add column published_by uuid references auth.users (id) on delete set null,
  -- sha256 of published_doc's canonical form -- hashBoardDoc() in
  -- lib/bundle/hash.ts, the same canonicalJson approach screen_bundles's own
  -- content_hash uses. Compared against a fresh hash of the draft to show
  -- unpublished-changes state without a document-equality check, which would
  -- flag a no-op autosave (or a move and a move back) as a change. Null
  -- exactly when published_doc is.
  add column published_hash text;

alter table public.boards
  add constraint boards_published_doc_object
    check (published_doc is null or jsonb_typeof(published_doc) = 'object');

-- boards_request_rebuild_upd used to fire on ANY update to a board --
-- statement-level with transition tables, no column filter, from
-- 20260904091400_rebuild_invalidation.sql. That included every 1-second
-- autosave write to the draft `doc` column, which queued an org-wide rebuild
-- for a save nothing downstream reads yet. Only `name` and `published_doc`
-- change what a bundle actually contains now, so this becomes row-level with
-- a WHEN guard -- the same shape orgs_request_rebuild_upd and
-- screens_request_rebuild_upd already use, and for the same reason given
-- there: a column filter and a transition table can't be combined on one
-- trigger, so a filtered update trigger has to give up the transition table,
-- not the other way around. The insert and delete triggers on boards are
-- unaffected -- a board nothing points at yet, and a board nothing points at
-- any more, are both cheap to over-invalidate for.
drop trigger if exists boards_request_rebuild_upd on public.boards;

create trigger boards_request_rebuild_upd
  after update on public.boards
  for each row
  when (
    old.name is distinct from new.name
    or old.published_doc is distinct from new.published_doc
  )
  execute function public.request_org_rebuild_row('org_id');
