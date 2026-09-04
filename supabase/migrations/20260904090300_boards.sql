-- Boards. The board document is a single jsonb column; there is no
-- board_widgets table.

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- Real columns, not fields inside doc: these are the denominator every
  -- percentage in doc is measured against, and the dashboard queries them to warn
  -- when a board's aspect does not match the screen it is scheduled on.
  canvas_width integer not null default 1920 check (canvas_width > 0),
  canvas_height integer not null default 1080 check (canvas_height > 0),
  doc jsonb not null default '{}'::jsonb check (jsonb_typeof(doc) = 'object'),
  doc_version integer not null default 1 check (doc_version > 0),
  is_template boolean not null default false,
  template_category text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Redundant, and required: children FK on (board_id, org_id) so a playlist item
  -- physically cannot point at a board in another org.
  constraint boards_id_org_key unique (id, org_id)
);

-- Widget positions inside doc are PERCENTAGES of canvas_width / canvas_height,
-- never pixels. The database does not enforce that -- the jsonb_typeof check above
-- is a sanity guard and nothing more. parseBoardDoc() in lib/board-doc.ts is the
-- only validator, and every write path must go through it. See lib/board-doc.ts
-- and docs/schema.md §5.

create index boards_org_idx on public.boards (org_id) where deleted_at is null;
create index boards_org_template_idx on public.boards (org_id, is_template);

-- Replaces the queryability the board_widgets table gave for free:
--   which boards contain a widget type:
--     doc @> '{"widgets":[{"type":"zmanim"}]}'
--   which boards reference an album, for the delete-dialog warning:
--     doc @> '{"widgets":[{"config":{"album_id":"..."}}]}'
--   which boards use a zmanim provider, for the divergence warning (plan §5c)
-- jsonb_ops rather than jsonb_path_ops because it supports key-existence as well
-- as containment; narrow it later if every query turns out to be @>.
create index boards_doc_gin on public.boards using gin (doc);

create trigger boards_set_updated_at
  before update on public.boards
  for each row execute function public.set_updated_at();

alter table public.boards enable row level security;

create policy "boards are visible to their org"
  on public.boards for select to authenticated
  using (public.is_org_member(org_id));

create policy "boards are created by editors"
  on public.boards for insert to authenticated
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "boards are updated by editors"
  on public.boards for update to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'))
  with check (public.has_org_role_at_least(org_id, 'editor'));

create policy "boards are deleted by editors"
  on public.boards for delete to authenticated
  using (public.has_org_role_at_least(org_id, 'editor'));
