-- Who changed the announcement (plan.md §8).

create table public.audit_log (
  -- bigint, not uuid: high-volume append-only, and a uuid primary key costs index
  -- size for nothing.
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  actor_kind public.audit_actor_kind not null default 'user',
  -- Nullable on purpose: deleting a user must not delete the record of what they
  -- did.
  actor_user_id uuid references auth.users (id) on delete set null,
  -- Text, not an enum: this list grows with every feature.
  action text not null check (length(btrim(action)) > 0),
  entity_table text not null,
  entity_id uuid,
  -- Human-readable, written by the caller: "Changed Mincha from 7:15 to 7:20".
  -- This is what the UI shows; `changed` is for when someone needs the detail.
  summary text,
  -- Old and new values for changed keys only, never whole rows.
  changed jsonb,
  ip inet,
  user_agent text,
  -- No updated_at. Audit rows are never updated.
  created_at timestamptz not null default now()
);

create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
create index audit_log_entity_idx
  on public.audit_log (org_id, entity_table, entity_id, created_at desc);

alter table public.audit_log enable row level security;

-- Select is admin, not member: `changed` can contain anything from any table,
-- including names and dates out of people, so the log inherits the sensitivity of
-- the most sensitive thing it records.
create policy "the audit log is readable by admins"
  on public.audit_log for select to authenticated
  using (public.has_org_role_at_least(org_id, 'admin'));

-- No write policies at all. Rows are written by security definer triggers and by
-- server-only routes, both of which bypass RLS. That also means no client can
-- delete or edit an audit row, which is most of what makes this an audit log
-- rather than a changelog.
