# Data model proposal

Companion to `plan.md` §1, §8, §9. This is a proposal, not a migration — no SQL
here. Read the open questions at the end before anyone writes the first
migration.

Target: Supabase Postgres. Every statement below assumes RLS is on and forced.

**Revision note.** Seven decisions have been applied since the first draft: the
board document is a single `jsonb` column rather than a `board_widgets` table;
`has_org_role` is now `has_org_role_at_least` with confirmed ranking semantics;
`zmanim_cache` stays shared with no `org_id`; heartbeats are bucketed hourly;
`org_invites`, `audit_log`, `calendar_events` and `screen_bundles` are added; and
bundle invalidation is org-wide by design. §10 is the one section to read before
touching anything about rebuilds.

---

## 1. Conventions

These hold for every table unless the table's own section says otherwise.

- **Primary keys** are `uuid`, defaulted from `gen_random_uuid()`. Exceptions:
  `audit_log` uses a `bigint` identity because it is high-volume append-only, and
  `screen_heartbeats` and `screen_bundles` use natural composite or foreign keys
  described in their own sections.
- **`org_id uuid not null`** on every tenant table, referencing `orgs(id)` with
  `on delete cascade`. It is *denormalized onto every child table*, including
  grandchildren like `album_items` and `calendar_events`. This is the most
  important decision in the document and §13 explains why.
- **Composite foreign keys keep the denormalized `org_id` honest.** Each parent
  gets a redundant `unique (id, org_id)` constraint, and each child's FK is
  `(parent_id, org_id) → parent(id, org_id)` rather than `parent_id → parent(id)`.
  A row therefore physically cannot point at a parent in a different org, and the
  denormalized column cannot drift. Cost: one extra unique index per parent.
- **Timestamps** are `timestamptz`, never `timestamp`. Every table has
  `created_at timestamptz not null default now()` and, where rows are editable,
  `updated_at timestamptz not null default now()` maintained by a shared
  `set_updated_at()` trigger.
- **Dates that are calendar dates** (a birth date, a zmanim cache date) are
  `date`. They are not instants and must not become `timestamptz`.
- **Soft delete** (`deleted_at timestamptz null`) only on `orgs`, `boards`,
  `assets`, and `people` — the four things a user will ask you to undo. See open
  question 10.
- **Text, not varchar.** No length limits in the type; use check constraints
  where a real limit exists.
- **Money and counts** are `integer` or `bigint`. No `float` anywhere.
- `created_by uuid` columns reference `auth.users(id)` with `on delete set null`
  and are nullable, because a deleted user must not delete their announcements.

---

## 2. Enums

Postgres enums are cheap to add values to and painful to remove or reorder from.
Use an enum where the set is genuinely closed, and `text` + a check constraint
where it will churn.

| Enum | Values | Notes |
|---|---|---|
| `org_role` | `owner`, `admin`, `editor`, `viewer` | Ranked, in that order. §12 defines the ranking. |
| `album_source` | `manual`, `drive`, `photos_import`, `email` | All four exist from migration one; only `manual` is reachable in v1 (plan §6). |
| `asset_kind` | `image`, `video` | |
| `asset_status` | `pending`, `processing`, `ready`, `failed` | Drives the upload UI's per-file state. |
| `moderation_status` | `approved`, `pending`, `rejected` | Only meaningful for share-link uploads. |
| `zmanim_provider` | `hebcal`, `chabad`, `myzmanim`, `manual` | Plan §5c. |
| `nusach` | `ashkenaz`, `sefard`, `ari`, `edot_hamizrach` | |
| `screen_orientation` | `landscape`, `portrait` | |
| `announcement_status` | `draft`, `published`, `archived` | |
| `schedule_kind` | `davening`, `shiur`, `other` | The Davening Hours and Class Schedule widgets each filter on this. |
| `schedule_time_kind` | `fixed`, `zman_relative` | "Mincha 20 minutes before shkia" is not a fixed time. |
| `calendar_provider` | `google` | One value today; the column exists so the second one isn't a migration. |
| `calendar_event_status` | `confirmed`, `tentative`, `cancelled` | Google's incremental sync delivers deletions as `cancelled`, not as absences. |
| `sync_status` | `never`, `ok`, `error` | |
| `person_gender` | `male`, `female`, `unspecified` | Needed for ben/bat construction and Hebrew grammar, not for anything else. |
| `upload_source` | `dashboard`, `share_link` | |
| `audit_actor_kind` | `user`, `system`, `share_link` | Not every audited action has a signed-in actor. |

**Not an enum:** the canonical zman IDs (`alos_72`, `netz`, `sof_zman_shma_gra`,
…). Seventeen values that will grow, referenced from jsonb in three places. See
open question 8.

**Also not an enum:** widget type. Adding widget #26 must mean creating one folder
and nothing else (plan §5), and an enum would make it a migration.

---

## 3. Tenant root

### orgs

The tenant. Its own `id` is the `org_id` every other table points at.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text not null | "Beis Menachem" |
| `slug` | text not null | Lowercase, URL-safe. Check `slug ~ '^[a-z0-9-]+$'`. |
| `timezone` | text not null default `'America/New_York'` | IANA name. Default for screens. |
| `latitude` | double precision null | Default zmanim location. |
| `longitude` | double precision null | |
| `elevation_m` | integer null | Some zmanim calculations use it. |
| `postal_code` | text null | What MyZmanim's `searchPostal` takes. |
| `country_code` | text null | ISO 3166-1 alpha-2. |
| `zmanim_provider` | `zmanim_provider` not null default `'hebcal'` | Org default; screens override. |
| `myzmanim_location_id` | text null | Cached from `searchPostal` at onboarding (plan §5c). |
| `nusach` | `nusach` not null default `'ashkenaz'` | Drives davening labels and some zmanim defaults. |
| `hebrew_prefs` | jsonb not null default `'{}'` | Script vs transliteration, gematria, nekudos, sunset rollover, 12/24h. Org default; screens override. |
| `theme` | jsonb not null default `'{}'` | Org design tokens (plan §4d) — palette, font pairing, spacing, radius. |
| `plan` | text not null default `'free'` | Placeholder until Stripe (P8). |
| `screen_limit` | integer null | Null = unlimited. See open question 4. |
| `created_by` | uuid null → `auth.users(id)` | |
| `created_at` / `updated_at` | timestamptz not null | |
| `deleted_at` | timestamptz null | Owner-only soft delete. |

**Keys and indexes**

- pk `(id)`
- unique `(slug)`

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(id)` | — |
| insert | — | `created_by = (select auth.uid())` |
| update | `has_org_role_at_least(id, 'admin')` | `has_org_role_at_least(id, 'admin')` |
| delete | `has_org_role_at_least(id, 'owner')` | — |

Insert is deliberately open to any authenticated user: creating an org is how you
sign up. A trigger inserts the creator into `org_members` as `owner` in the same
transaction — without it, the creator immediately loses select access to the row
they just made.

Deleting an org is `owner` only, per plan §8, and in practice should be a soft
delete plus a scheduled hard delete rather than a real `delete`.

### org_members

| Column | Type | Notes |
|---|---|---|
| `org_id` | uuid not null → `orgs(id)` on delete cascade | |
| `user_id` | uuid not null → `auth.users(id)` on delete cascade | |
| `role` | `org_role` not null default `'viewer'` | |
| `invited_by` | uuid null → `auth.users(id)` | |
| `created_at` / `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(org_id, user_id)` — no surrogate key; the pair *is* the identity.
- index `(user_id, org_id) include (role)` — **this one is load-bearing.** Both
  helper functions probe by `user_id` first, and the PK index leads with
  `org_id`, so without this index every RLS check in the product is a scan.
  Including `role` makes `has_org_role_at_least` an index-only lookup.
- At-least-one-owner is not expressible as a constraint; use a `before delete` /
  `before update` trigger that refuses to remove the last `owner`.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role_at_least(org_id, 'admin')` |
| update | `has_org_role_at_least(org_id, 'admin')` | `has_org_role_at_least(org_id, 'admin')` |
| delete | `has_org_role_at_least(org_id, 'admin')` or `user_id = (select auth.uid())` | — |

The `or user_id = auth.uid()` on delete is "leave org", which shouldn't require
being an admin.

**This table is the recursion trap.** A policy on `org_members` that calls
`is_org_member()`, which itself selects from `org_members`, recurses infinitely
and Postgres will error out at runtime — not at definition time, so it ships. The
fix is that both helpers are `security definer` and therefore bypass RLS on
`org_members` when they run. That property is not an optimization, it is what
makes these policies terminate. Anyone "cleaning up" the helpers by dropping
`security definer` will take the whole app down.

A second trap: an `admin` can currently promote themselves to `owner`, since the
update policy only checks rank. See open question 11.

### org_invites

Pending invitations by email (plan §8).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `email` | text not null | Stored lowercased; check that it matches its own `lower()`. |
| `role` | `org_role` not null default `'viewer'` | The role granted on acceptance. Check `role <> 'owner'` — ownership transfers are a separate deliberate action, not an invite. |
| `token` | text not null | CSPRNG, single-use, in the accept link. |
| `invited_by` | uuid null → `auth.users(id)` | |
| `expires_at` | timestamptz not null | Check `> created_at`. An invite that never expires is a permanent unauthenticated path into an org. |
| `accepted_at` | timestamptz null | |
| `accepted_by` | uuid null → `auth.users(id)` | |
| `revoked_at` | timestamptz null | |
| `created_at` / `updated_at` | timestamptz not null | |

Status is derived from the four timestamps rather than stored as an enum, so the
row cannot claim `pending` while holding an `accepted_at`.

**Keys and indexes**

- pk `(id)`
- unique `(token)`
- unique `(org_id, email)` partial, where `accepted_at is null and revoked_at is
  null` — one live invite per address per org
- index `(org_id, created_at desc)`
- index `(expires_at)` partial where still pending, for the expiry sweep

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `has_org_role_at_least(org_id, 'admin')` | — |
| insert | — | `has_org_role_at_least(org_id, 'admin')` |
| update | `has_org_role_at_least(org_id, 'admin')` | `has_org_role_at_least(org_id, 'admin')` |
| delete | `has_org_role_at_least(org_id, 'admin')` | — |

Select is `admin`, not member — the table is a list of people's email addresses
and there is no reason for a `viewer` to read it.

**Accepting an invite cannot go through RLS.** The person clicking the link is by
definition not yet a member, so no policy keyed on `is_org_member` can authorize
the lookup, and a policy permissive enough to allow it would let anyone read every
invite in the product. Acceptance is therefore a server route holding the service
role: it validates the token, checks `expires_at`, `accepted_at` and `revoked_at`,
inserts the `org_members` row and stamps `accepted_at`, all in one transaction.
This is the same pattern as the bundle route, and it is the second of four places
the service role legitimately appears — see open question 1.

---

## 4. Screens and playlists

### screens

A screen points at a **playlist**, never at a board. There is deliberately no
`board_id` column here; adding one later to "simplify the common case" is how you
lose dayparting (plan §1).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `name` | text not null | "Main lobby" |
| `location_note` | text null | "Entrance, north wall" — the second line in the screens table. |
| `token` | text not null | 32 chars, CSPRNG, base32 or base58 (no ambiguous glyphs). The `/s/<token>` URL. |
| `token_rotated_at` | timestamptz null | |
| `pairing_code` | text null | `ABC-123`. Short-lived alternative entry (plan §1). |
| `pairing_code_expires_at` | timestamptz null | Codes must expire; a permanent 6-char code is a permanent brute-force target. |
| `playlist_id` | uuid null → `playlists(id)` on delete set null | Null = screen shows the "not configured yet" state, not a black screen. |
| `orientation` | `screen_orientation` not null default `'landscape'` | |
| `canvas_width` / `canvas_height` | integer not null, default 1920 / 1080 | Design units the screen expects. |
| `timezone` | text null | Overrides org. Null = inherit. |
| `latitude` / `longitude` / `elevation_m` | null | Override org location for zmanim. |
| `postal_code` | text null | |
| `zmanim_provider` | `zmanim_provider` null | Null = inherit org. Plan §5c makes provider a screen-level setting. |
| `zmanim_location_id` | text null | The key into `zmanim_cache`. Resolved at save time, not at bundle time. |
| `hebrew_prefs` | jsonb not null default `'{}'` | Overrides org, overridden per widget. |
| `rebuild_requested_at` | timestamptz null | Set by invalidation, cleared by a successful build. §10. |
| `rebuild_last_attempt_at` | timestamptz null | |
| `rebuild_attempts` | integer not null default 0 | Drives backoff after repeated build failures. |
| `rebuild_last_error` | text null | Surfaced in the screen detail view. |
| `last_seen_at` | timestamptz null | Denormalized from heartbeats. §9 explains why. |
| `last_seen_bundle_version` | integer null | What the device says it is running, compared against `screen_bundles.version`. |
| `last_seen_board_id` | uuid null | The "Showing" column in the screens view. |
| `is_active` | boolean not null default true | |
| `created_at` / `updated_at` | timestamptz not null | |

There is no `bundle_version` column here. The version of the bundle currently
being served lives on `screen_bundles`, which is the row that actually changes
when a build succeeds; a second copy here would be a second source of truth for
the one value the display polls on.

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)` for child composite FKs
- **unique `(token)`** — the display route's only lookup. Globally unique, not
  per org.
- unique `(pairing_code)` partial, where `pairing_code is not null`
- index `(org_id)` — every RLS-filtered list query starts here
- index `(playlist_id)`
- index `(org_id, last_seen_at desc)` for the screens view's status sort
- index `(rebuild_requested_at)` partial where not null — the build worker's
  queue, kept tiny because rows leave it on success

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role_at_least(org_id, 'admin')` |
| update | `has_org_role_at_least(org_id, 'admin')` | `has_org_role_at_least(org_id, 'admin')` |
| delete | `has_org_role_at_least(org_id, 'admin')` | — |

Screens are `admin`, not `editor` — plan §8 assigns screens to admin explicitly,
and an editor rotating a token silently blacks out a lobby.

The display route never touches these policies. It reads with the service role in
`app/api/screen/[token]/bundle/`, having validated the token itself.

### playlists

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `name` | text not null | |
| `description` | text null | |
| `default_duration_seconds` | integer not null default 30 | Per-item override below. |
| `transition` | text not null default `'crossfade'` | |
| `created_by` / `updated_by` | uuid null | |
| `created_at` / `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)`
- unique `(org_id, lower(name))` — stops two "Weekday" playlists
- index `(org_id)`

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role_at_least(org_id, 'editor')` |
| update | `has_org_role_at_least(org_id, 'editor')` | `has_org_role_at_least(org_id, 'editor')` |
| delete | `has_org_role_at_least(org_id, 'admin')` | — |

Delete is `admin` because deleting a playlist that a screen points at is a
blanking operation, even with `on delete set null`.

### playlist_items

The join between a playlist and a board, carrying order and schedule.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `playlist_id` | uuid not null | Composite FK `(playlist_id, org_id)`, on delete cascade. |
| `board_id` | uuid not null | Composite FK `(board_id, org_id)`, **on delete restrict**. |
| `position` | numeric not null | Fractional ordering — insert between 1.0 and 2.0 as 1.5, so a reorder writes one row, not the whole list. |
| `duration_seconds` | integer null | Null = inherit playlist default. Check `> 0`. |
| `schedule` | jsonb not null default `'{}'` | Dayparting: days of week, time window, date range, Shabbos/yom-tov flags. |
| `priority` | integer not null default 0 | Higher wins. The event-takeover mechanism (plan §9 P6). |
| `is_enabled` | boolean not null default true | |
| `created_at` / `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(id)`
- unique `(playlist_id, position)`
- index `(playlist_id, position)` — the bundle builder's read path
- index `(board_id)` — to answer "is this board in use" before allowing a delete
- index `(org_id)`

`on delete restrict` on `board_id` is intentional: deleting a board that is
scheduled on a live screen should fail loudly and name the playlist holding it,
rather than silently emptying a rotation. Note that this is now the *only*
referential protection a board gets — see open question 14 for what the move to a
jsonb document costs on the asset and album side.

**RLS** — select for members, all writes for `editor`.

---

## 5. Boards

### boards

The board document is a **single `jsonb` column**. There is no `board_widgets`
table.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `name` | text not null | "Weekday board" |
| `canvas_width` / `canvas_height` | integer not null, default 1920 / 1080 | Real columns, not fields in the document. They are the denominator every percentage in `doc` is measured against, and the dashboard needs to query them to warn when a board's aspect doesn't match the screen it's scheduled on. The document does not repeat them. |
| `doc` | jsonb not null default `'{}'` | The whole board: widgets, positions, z-order, theme overrides, background. Shape below. |
| `doc_version` | integer not null default 1 | Optimistic concurrency for the 1s-debounced autosave. A save carrying a stale `doc_version` is rejected rather than silently overwriting a second editor. |
| `is_template` | boolean not null default false | The templates gallery in P8. |
| `template_category` | text null | |
| `created_by` / `updated_by` | uuid null | |
| `created_at` / `updated_at` | timestamptz not null | |
| `deleted_at` | timestamptz null | |

**Document shape**

```
{
  schema_version: 1,
  background:      { … token or asset reference, never a raw hex },
  theme_overrides: { … deviations from the org theme },
  widgets: [
    {
      id:       uuid,
      type:     "zmanim",          // matches widgets/<name>/manifest.ts
      x: 12.5, y: 4.0, w: 30.0, h: 22.5,   // PERCENTAGES
      rotation: 0,
      z:        3,
      locked:   false,
      hidden:   false,
      opacity:  1,
      group_id: uuid | null,
      config:         { … validated by the widget's zod settingsSchema },
      style_overrides:{ … }
    },
    …
  ]
}
```

`schema_version` is present from the first write. Without a column-level DDL step
to hang a migration on, changing the document's shape later is a data migration
over jsonb, and an unversioned document makes that guesswork. See open question
16.

**Positions are percentages, and nothing in the database enforces it.**

`x` and `w` are percentages of `canvas_width`; `y` and `h` are percentages of
`canvas_height`. Values may fall slightly outside 0–100 because a widget can
legitimately hang off the canvas edge; the documented valid range is -100 to 200,
which is wide enough for real layouts and narrow enough that a stray pixel value
like `960` is obviously wrong.

The previous draft enforced that range with a check constraint on a real column.
With the document in `jsonb` that constraint is gone, and **the zod schema is now
the only guard.** That is a real reduction in safety and it has one practical
consequence worth stating plainly: the validation must run on *every* write path,
not just the editor's autosave. Template instantiation, board duplication, board
import, a future "copy board to another org", and any repair script all write
`doc` directly and all need the same validator. A single exported
`parseBoardDoc()` that every writer must call — with no path that writes `doc`
without going through it — is what replaces the constraint. A check constraint
over jsonb could reimpose some of this, but it would have to walk the array in
SQL on every write, and it would still not validate widget `config` against the
per-widget zod schemas, which is where the interesting invalid data actually
comes from.

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)`
- index `(org_id)` where `deleted_at is null`
- index `(org_id, is_template)` for the gallery
- **gin index on `doc`** — this is what replaces the queryability the
  `board_widgets` table gave for free. The queries it serves:
  - which boards contain a given widget type:
    `doc @> '{"widgets":[{"type":"zmanim"}]}'`
  - which boards bind to a given album, before allowing an album delete:
    `doc @> '{"widgets":[{"config":{"album_id":"…"}}]}'`
  - which boards use a given zmanim provider, for the divergence warning in plan
    §5c

  Default `jsonb_ops` supports both containment and key-existence. If every query
  turns out to be containment (`@>`), `jsonb_path_ops` builds a smaller, faster
  index; that choice can be deferred until the query set is real.

No stored thumbnail column. `design.md` specifies the screens-view thumbnail as a
real render through the shared widget renderer, so a cached image would be a
second source of truth that goes stale.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role_at_least(org_id, 'editor')` |
| update | `has_org_role_at_least(org_id, 'editor')` | `has_org_role_at_least(org_id, 'editor')` |
| delete | `has_org_role_at_least(org_id, 'editor')` | — |

One consequence of the single-column design worth noting here rather than in the
open questions, because it is a property of the decision rather than a doubt about
it: RLS on this table is now trivially cheap. A board is one row, so the editor's
load is a single primary-key lookup with one function call, not a scan of a
widgets table under a per-row policy. The table that was the second-biggest RLS
performance risk in the first draft is no longer a risk at all.

---

## 6. Media

### assets

One row per uploaded file. Bytes live in Supabase Storage; this table is the
index and the processing state machine.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `kind` | `asset_kind` not null | |
| `storage_bucket` | text not null default `'assets'` | |
| `storage_path` | text not null | Convention: `<org_id>/<asset_id>/original.<ext>`. Leading segment is the org id so storage policies can key on it. |
| `original_filename` | text null | |
| `mime_type` | text not null | Post-conversion. HEIC never survives to here as a servable type. |
| `byte_size` | bigint null | |
| `width` / `height` | integer null | |
| `aspect_ratio` | numeric generated always as `width::numeric / nullif(height, 0)` stored | Collage template matching (plan §7) scores against this on every re-roll. Generated, so it cannot disagree with the dimensions. |
| `duration_seconds` | numeric null | Video only. |
| `checksum_sha256` | text null | Dedupe within an org. |
| `variants` | jsonb not null default `'{}'` | `{thumb, display, large}` × `{webp, avif}` paths (plan §6). |
| `status` | `asset_status` not null default `'pending'` | |
| `processing_error` | text null | Shown per-file in the upload UI. |
| `exif_stripped` | boolean not null default false | Derivatives must have GPS removed before they are servable. |
| `caption` | text null | |
| `uploaded_by` | uuid null → `auth.users(id)` | Null for share-link uploads. |
| `upload_source` | `upload_source` not null default `'dashboard'` | |
| `moderation_status` | `moderation_status` not null default `'approved'` | Share-link uploads insert as `pending`. |
| `created_at` / `updated_at` | timestamptz not null | |
| `deleted_at` | timestamptz null | |

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)`
- unique `(org_id, checksum_sha256)` partial, where checksum is not null
- index `(org_id, created_at desc)` where `deleted_at is null` — the media grid
- index `(org_id, status)` partial where status is not `'ready'` — the processing
  queue
- index `(org_id, moderation_status)` partial where `'pending'` — the moderation
  queue

**RLS** — select for members; insert, update and delete for `editor`.

**Storage needs its own policies.** RLS here protects the metadata, not the bytes.
`storage.objects` needs a parallel set of policies keyed on the first path segment
of `name` being an org the user belongs to. Getting one right and forgetting the
other is the most common way a multi-tenant Supabase app leaks files.

### albums

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `name` | text not null | |
| `description` | text null | |
| `source` | `album_source` not null default `'manual'` | **All four enum values exist from the first migration** (plan §6). v1 only ever writes `'manual'`; a check constraint restricting it to `'manual'` for now is fine and easy to drop. |
| `source_config` | jsonb null | Nullable from day one. Drive folder id, mailbox address, etc. Stays null in v1. |
| `cover_asset_id` | uuid null | Composite FK `(cover_asset_id, org_id)`, on delete set null. |
| `share_token` | text null | The `/u/<token>` upload link (plan §6). |
| `share_enabled` | boolean not null default false | |
| `share_expires_at` | timestamptz null | |
| `moderation_required` | boolean not null default true | If the share link is on, this should not be off by default. |
| `created_at` / `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)`
- unique `(share_token)` partial, where not null
- index `(org_id)`

**RLS** — select for members, all writes for `editor`.

### album_items

Many-to-many. An asset belongs to any number of albums.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `album_id` | uuid not null | Composite FK, on delete cascade. |
| `asset_id` | uuid not null | Composite FK, on delete cascade. |
| `position` | numeric not null | Fractional, same scheme as `playlist_items`. |
| `caption` | text null | Per-album override; falls back to `assets.caption`. |
| `created_at` | timestamptz not null | |

**Keys and indexes**

- pk `(id)`
- unique `(album_id, asset_id)`
- index `(album_id, position)` — the gallery read path and the auto-fill re-roll
- index `(asset_id)` — "which albums is this in", needed before a delete
- index `(org_id)`

**RLS** — select for members, all writes for `editor`.

---

## 7. Org content

### people

Holds both birthdays and yahrzeits, with Hebrew and Gregorian dates for each.

The Hebrew date is stored **structured, not as a formatted string**, because the
yahrzeit lookahead filters on month and day. A `text` column reading `'23 Elul'`
cannot be indexed usefully for "everyone in the next 60 days".

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `first_name` | text null | |
| `last_name` | text null | |
| `display_name` | text not null | What appears on the board. Explicit, not computed — "R' Yosef Cohen" is not derivable from the parts. |
| `hebrew_name` | text null | `יוסף בן שמעון` |
| `father_hebrew_name` | text null | For ben/bat construction and misheberachs. |
| `mother_hebrew_name` | text null | Used for different purposes than the father's name; both are needed. |
| `gender` | `person_gender` not null default `'unspecified'` | Drives ben/bat and Hebrew grammar only. |
| `birth_date_gregorian` | date null | |
| `birth_hebrew_year` | integer null | |
| `birth_hebrew_month` | text null | Check against the 14 names including `adar_i` and `adar_ii`. Numeric months are ambiguous across leap years. |
| `birth_hebrew_day` | smallint null | Check `between 1 and 30`. |
| `birth_after_sunset` | boolean not null default false | Determines which Hebrew date the Gregorian one maps to. |
| `death_date_gregorian` | date null | |
| `death_hebrew_year` | integer null | |
| `death_hebrew_month` | text null | Same check. |
| `death_hebrew_day` | smallint null | |
| `death_after_sunset` | boolean not null default false | The sunset-of-death question in plan §9 P4. Not optional; it moves the yahrzeit by a day. |
| `burial_date_gregorian` | date null | Some hold the first yahrzeit follows burial, not death. Hebcal's anniversary API accepts it. |
| `yahrzeit_first_year_rule` | text null | `'death'` or `'burial'`. Null = org default. |
| `commemorated_by` | text null | "The Cohen family" — what the board prints under a yahrzeit. |
| `photo_asset_id` | uuid null | Composite FK, on delete set null. |
| `show_on_boards` | boolean not null default true | A person can be recorded without being displayed. |
| `notes` | text null | |
| `created_by` / `updated_by` | uuid null | |
| `created_at` / `updated_at` | timestamptz not null | |
| `deleted_at` | timestamptz null | |

**Constraints**

- At least one of `birth_date_gregorian`, `birth_hebrew_day`,
  `death_date_gregorian`, `death_hebrew_day` is present. A person row with no date
  is a contact, not a bulletin-board entry.
- The Hebrew triple is all-or-nothing: year, month and day either all null or all
  present, for each of birth and death.

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)`
- index `(org_id, death_hebrew_month, death_hebrew_day)` partial where
  `death_hebrew_day is not null` — the yahrzeit lookahead
- index `(org_id, birth_hebrew_month, birth_hebrew_day)` partial where not null
- index `(org_id, birth_date_gregorian)` for shuls running Gregorian birthdays
- index `(org_id)` where `deleted_at is null`

**No materialized occurrence rows.** The 60-day lookahead is computed at bundle
build time from the Hebrew month and day via `@hebcal/core` and the Hebcal
anniversary API. See open question 6.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role_at_least(org_id, 'editor')` |
| update | `has_org_role_at_least(org_id, 'editor')` | `has_org_role_at_least(org_id, 'editor')` |
| delete | `has_org_role_at_least(org_id, 'admin')` | — |

Delete is `admin` here, unlike the other content tables. This is the one table
holding family and death records, and a mis-click is not recoverable from a
gabbai's memory.

### announcements

Called "notices" everywhere in the UI (`design.md` §4). The table keeps the longer
name; the interface does not.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `title` | text not null | |
| `body` | text null | |
| `status` | `announcement_status` not null default `'draft'` | |
| `starts_at` | timestamptz null | Null = show immediately. |
| `ends_at` | timestamptz null | Null = show until archived. Check `ends_at > starts_at`. |
| `is_pinned` | boolean not null default false | |
| `priority` | integer not null default 0 | Sort order within the widget. |
| `asset_id` | uuid null | Composite FK, on delete set null. Optional image. |
| `created_by` / `updated_by` | uuid null | |
| `created_at` / `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(id)`
- index `(org_id, starts_at, ends_at)` partial where `status = 'published'` — the
  bundle builder's only query against this table
- index `(org_id, status, updated_at desc)` for the dashboard list

**RLS** — select for members, all writes for `editor`.

### schedules

Davening times and shiurim. One row per recurring item ("Shacharis, weekdays,
7:00"), not one row per named schedule. See open question 7.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `kind` | `schedule_kind` not null | The Davening Hours and Class Schedule widgets each filter on this. |
| `label` | text not null | "Shacharis", "Daf yomi" |
| `hebrew_label` | text null | |
| `time_kind` | `schedule_time_kind` not null default `'fixed'` | |
| `fixed_time` | time null | Required when `time_kind = 'fixed'`. |
| `zman_id` | text null | Canonical zman id (plan §5c). Required when `time_kind = 'zman_relative'`. |
| `zman_offset_minutes` | integer null | Negative = before. "20 minutes before shkia" is `shkia`, `-20`. |
| `days_of_week` | smallint[] not null default `'{}'` | 0 = Sunday. Empty = governed entirely by `applies_on`. |
| `applies_on` | jsonb not null default `'{}'` | Shabbos, yom tov, rosh chodesh, fast days, chol hamoed — the flags a weekday array can't express. |
| `effective_from` / `effective_to` | date null | Seasonal Mincha. |
| `location_note` | text null | "Beis medrash" |
| `position` | numeric not null | Display order within the widget. |
| `is_active` | boolean not null default true | |
| `notes` | text null | |
| `created_by` / `updated_by` | uuid null | |
| `created_at` / `updated_at` | timestamptz not null | |

**Constraints**

- `time_kind = 'fixed'` implies `fixed_time is not null`; `time_kind =
  'zman_relative'` implies `zman_id is not null`. Exactly one shape, enforced.
- All `days_of_week` values between 0 and 6.

**Keys and indexes**

- pk `(id)`
- index `(org_id, kind, position)` partial where `is_active` — the widget read
  path
- index `(org_id, effective_from, effective_to)` if seasonal schedules get common

**RLS** — select for members, all writes for `editor`.

### calendar_connections

Google Calendar links (plan §5, §9 P4). **This table holds OAuth credentials, and
that changes its access rules.**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `provider` | `calendar_provider` not null default `'google'` | |
| `account_email` | text null | Whose Google account this is. Shown in settings so a gabbai can tell which one broke. |
| `calendar_id` | text not null | External calendar identifier. |
| `calendar_name` | text null | Cached display name. |
| `vault_secret_id` | uuid null | Pointer into Supabase Vault holding the refresh token. **The token itself is not a column on this table.** |
| `sync_token` | text null | Google's incremental sync cursor. |
| `sync_status` | `sync_status` not null default `'never'` | |
| `sync_error` | text null | |
| `last_synced_at` | timestamptz null | |
| `is_active` | boolean not null default true | |
| `created_by` | uuid null | |
| `created_at` / `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)`
- unique `(org_id, provider, calendar_id)` — connecting the same calendar twice is
  always a mistake
- index `(org_id)`
- index `(sync_status, last_synced_at)` for the sync worker's queue

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role_at_least(org_id, 'admin')` |
| update | `has_org_role_at_least(org_id, 'admin')` | `has_org_role_at_least(org_id, 'admin')` |
| delete | `has_org_role_at_least(org_id, 'admin')` | — |

**RLS does not protect columns.** If the refresh token were a column here, every
`viewer` in the org could select it, because RLS filters rows and nothing else.
Two ways out, and the schema above takes the first:

1. Keep the secret out of the table. Store it in Supabase Vault and hold only
   `vault_secret_id`. The sync worker reads Vault with the service role; the
   client never can.
2. Keep the column but `revoke select (refresh_token) from authenticated` and
   expose a `security_invoker` view without it. This works, but column grants are
   easy to lose in a later migration and nothing fails loudly when you do.

### calendar_events

Tenant-scoped cache of synced events. The bundle ships 30 days of events for
offline use (plan §3a), so the builder must read them from here — it must never
call Google inline.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `connection_id` | uuid not null | Composite FK `(connection_id, org_id)`, on delete cascade. |
| `external_id` | text not null | Google's event id. |
| `recurring_event_id` | text null | The master's id when this row is an expanded instance. |
| `ical_uid` | text null | Stable across calendars; useful for dedupe when two connections carry the same event. |
| `title` | text not null | |
| `description` | text null | |
| `location` | text null | |
| `is_all_day` | boolean not null default false | |
| `starts_at` / `ends_at` | timestamptz null | Timed events. |
| `start_date` / `end_date` | date null | All-day events. An all-day event is a date, not an instant, and storing it as midnight-in-some-zone is how it lands on the wrong day on a screen in another timezone. |
| `timezone` | text null | The event's own zone as Google reports it. |
| `status` | `calendar_event_status` not null default `'confirmed'` | |
| `html_link` | text null | |
| `remote_etag` | text null | |
| `remote_updated_at` | timestamptz null | |
| `synced_at` | timestamptz not null | |
| `created_at` / `updated_at` | timestamptz not null | |

**Constraints**

- Exactly one shape present: either both `starts_at` and `ends_at`, or both
  `start_date` and `end_date`, consistent with `is_all_day`.

**Keys and indexes**

- pk `(id)`
- unique `(connection_id, external_id)` — the upsert target for incremental sync
- index `(org_id, starts_at)` partial where `status <> 'cancelled'` — the 30-day
  lookahead the builder runs
- index `(org_id, start_date)` partial, same predicate, for all-day events
- index `(connection_id, synced_at)` — finding rows the last sync didn't touch

Recurring events are stored **expanded into instances** within the sync window
(Google's `singleEvents=true`), not as masters plus rules. The bundle needs a flat
30-day list and nothing in the product needs to edit a series. See open question
15 for what that costs.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert / update / delete | *no policy* | *no policy* |

Like `zmanim_cache`, this is a cache: only the sync worker writes it, with the
service role. A client-writable event cache would let an editor put words on a
lobby screen that never existed in the shul's calendar.

---

## 8. Shared cache — not tenant-scoped

### zmanim_cache

**This table has no `org_id` and is not tenant-scoped.** That is deliberate and it
is the entire point: twenty Crown Heights shuls resolve to the same `location_id`,
so one API call and one row serves all of them (plan §5c). Adding `org_id` here
would multiply MyZmanim's per-location billing by the number of customers in a
neighborhood. Confirmed correct as proposed; the only follow-up is amending the
CLAUDE.md rule that this table contradicts (open question 1).

| Column | Type | Notes |
|---|---|---|
| `provider` | `zmanim_provider` not null | |
| `location_id` | text not null | Provider-namespaced. MyZmanim's internal `LocationID`; for Hebcal, a derived key such as `geo:40.669,-73.943` rounded to fixed precision so nearby shuls collide on purpose. |
| `date` | date not null | Local calendar date at that location. |
| `timezone` | text not null | IANA name. Needed to interpret the times below. |
| `times` | jsonb not null | Canonical zman id → `{ "iso": "…", "display": "6:42 pm" }`. **Both.** The plan forbids re-rounding or recomputing provider output, so the provider's own rendered string is stored verbatim and displayed verbatim; the ISO value exists for countdowns and sorting only. |
| `raw_response` | jsonb null | The provider's untouched payload. Worth the bytes: Chabad.org's endpoint is undocumented and will change shape without notice, and this is the only way to diagnose it afterwards. |
| `fetched_at` | timestamptz not null default now() | |
| `source_version` | text null | Adapter version, so a mapping bug can be identified and those rows re-fetched. |

**Keys and indexes**

- **pk `(provider, location_id, date)`** — exactly as the plan specifies. The
  bundle's 90-day read is a range scan on this index and needs nothing else.
- index `(fetched_at)` for the pruning job.
- No partitioning. Even 500 locations × 4 providers × 400 days is under a million
  rows.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `(select auth.role()) = 'authenticated'` | — |
| insert / update / delete | *no policy* | *no policy* |

No write policy means no client can write, ever. The cache-warming cron and the
bundle builder use the service role. The select policy exists so the zmanim
settings UI can preview real times while the gabbai is picking rows.

One caveat: any authenticated user can read every cached location, which weakly
leaks the set of neighborhoods with customers. Restricting select to locations the
user's orgs actually use would turn a primary-key lookup into a join on the
hottest read path in the product. I'd take the leak.

---

## 9. Display serving and telemetry

### screen_bundles

The built bundle, one row per screen. **The build is a background job; the display
route only ever reads this table.**

| Column | Type | Notes |
|---|---|---|
| `screen_id` | uuid pk | Composite FK `(screen_id, org_id)` → `screens(id, org_id)`, on delete cascade. The screen *is* the key — there is exactly one current bundle per screen. |
| `org_id` | uuid not null | |
| `version` | integer not null | Monotonic per screen. Bumped only when the content actually changed; see below. |
| `content_hash` | text not null | sha256 of the payload. Served verbatim as the ETag (plan §3a). |
| `payload` | jsonb not null | The built bundle: board documents, resolved announcements, 60 days of birthdays and yahrzeits, 30 days of events, 90 days of zmanim, asset URLs, theme tokens. |
| `byte_size` | integer not null | Cheap observability on bundle growth. A screen whose bundle crosses a few MB is a support call waiting to happen. |
| `ttl_seconds` | integer not null default 3600 | The `ttl` the bundle document carries. |
| `built_at` | timestamptz not null | |
| `build_duration_ms` | integer null | |
| `source_versions` | jsonb null | What went in: the zmanim rows' `fetched_at`, the calendar `synced_at`, content timestamps. Turns "why is this screen showing last week's times" into a lookup instead of an investigation. |
| `created_at` / `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(screen_id)`
- index `(org_id)`
- index `(built_at)` for staleness monitoring

**The 304 path must not read `payload`.** A poll carrying `If-None-Match` needs
only `version` and `content_hash`. Postgres stores a large `payload` out of line in
TOAST, so a query that selects just those two columns never detoasts or
decompresses the big one. Selecting `*` on that path would make every 60-second
poll from every screen in the product pay for a full bundle read to answer "no
change" — a nice-looking `select *` is the difference between a trivial query and
the most expensive one in the system.

**A failed build leaves the previous bundle serving.** This is the central
property of the design and it is why the bundle lives in its own table rather than
in a column on `screens`. The build job constructs the new payload in memory,
hashes it, and only then writes the row. Any failure — a widget that throws, a
missing asset, a zmanim gap, an out-of-memory — aborts before the write, so the
existing row is untouched and every screen polling it keeps getting the last good
bundle with its last good ETag. Failures are recorded on `screens`
(`rebuild_attempts`, `rebuild_last_error`, `rebuild_last_attempt_at`) and surfaced
in the dashboard, but they never blank a screen. The display never sees a partial
bundle because a partial bundle is never written.

**`version` bumps only on real change.** After building, the job compares the new
`content_hash` against the stored one. If they match, it updates `built_at` and
`source_versions` and leaves `version` and `payload` alone; screens see an
unchanged ETag and stay on their current bundle without a refetch or a cross-fade.
This is what makes the deliberately over-eager invalidation in §10 cheap at the
display layer.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert / update / delete | *no policy* | *no policy* |

Only the build job writes, with the service role. Member select exists so the
dashboard can show build state — version, `built_at`, size — without a second
table.

### screen_heartbeats

**One row per screen per hour**, not one row per beat. A screen POSTs every 60
seconds (plan §3e); the ingest route upserts into the current hour's bucket rather
than inserting a row.

| Column | Type | Notes |
|---|---|---|
| `screen_id` | uuid not null | Composite FK `(screen_id, org_id)`, on delete cascade. |
| `bucket_hour` | timestamptz not null | Truncated to the hour, UTC. |
| `org_id` | uuid not null | |
| `beat_count` | integer not null default 0 | Incremented per beat. 60 is a perfect hour; 41 is a screen that dropped out for nineteen minutes. |
| `first_beat_at` / `last_beat_at` | timestamptz not null | |
| `max_gap_seconds` | integer null | Longest silence within the hour, computed on each upsert as `now() - last_beat_at` when that exceeds the stored value. This is the one thing naive bucketing would destroy — without it, 41 beats could be one long outage or nineteen scattered misses, and those are different support calls. |
| `bundle_version` | integer null | Last reported. Compared against `screen_bundles.version` this detects a screen stuck on an old bundle — a failure that otherwise looks like a working screen. |
| `board_id` | uuid null | Last reported. Feeds the "Showing" column. |
| `app_version` | text null | Last reported. |
| `user_agent` | text null | Last reported. Which TV browser, for the inevitable support call. |
| `ip` | inet null | Last reported. See the retention note. |
| `viewport_width` / `viewport_height` | integer null | Catches a 4K screen running a 1080p board. |
| `uptime_seconds` | integer null | Last reported. Confirms the 3am self-reload is happening. |
| `error_count` | integer not null default 0 | **Summed** over the hour, not last-reported. |
| `last_error` | text null | |
| `created_at` / `updated_at` | timestamptz not null | |

Most columns are last-write-wins within the bucket; `beat_count` and `error_count`
accumulate and `max_gap_seconds` takes the maximum. Worth writing down, because an
upsert that overwrites `beat_count` instead of incrementing it looks correct and
silently makes the whole table say "1".

**Keys and indexes**

- pk `(screen_id, bucket_hour)` — also the upsert conflict target
- index `(org_id, bucket_hour desc)` for org-wide uptime views
- index `(bucket_hour)` for the retention sweep

**Volume, which is the point of bucketing.** Per beat, one screen produced ~1,440
rows a day and fifty screens produced ~26 million rows a year. Bucketed, one
screen produces 24 rows a day and fifty screens produce ~438,000 rows a year — a
sixtyfold reduction that turns the largest table in the database into an ordinary
one. Retention stops being mandatory; 90 days is comfortable and a year is
affordable if anyone wants annual uptime reporting.

The cost is write contention: sixty updates an hour to a single row per screen.
At this scale that is nothing, but the row is updated in place repeatedly and
wants normal autovacuum attention rather than a special setting.

**The denormalized columns on `screens` remain the read path.**
`screens.last_seen_at`, `last_seen_bundle_version` and `last_seen_board_id` are
written by the same ingest route that upserts the bucket. The screens view — the
product's identity view per `design.md` §4 — renders from a single indexed scan of
`screens`, never from this table. Bucketing makes this table small enough to query
directly, but "small enough" is not a reason to put a join on the most-visited page
in the app; this table is for history and diagnosis, and `screens` is for the wall
of green dots.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert / update / delete | *no policy* | *no policy* |

No insert policy is not an oversight. The heartbeat comes from `/s/[token]`, which
has no session and no `auth.uid()` to write a policy against. It posts to a server
route that validates the token and upserts with the service role. A
client-writable heartbeat table would let anyone forge liveness for any screen.

**Retention and privacy.** `ip` and `user_agent` on a device in a shul lobby are a
record of a physical building. Bucketing already reduces the granularity sixtyfold
— one address per hour rather than sixty — and a 90-day sweep should still run.

---

## 10. Bundle building and invalidation

**Invalidation is org-wide. Any content change marks every screen in that org for
rebuild. This is deliberate. Do not optimize it.**

Concretely: a write to any content table sets `rebuild_requested_at = now()` on
every row of `screens` where `org_id` matches. One statement, one index scan, no
joins. A shul with six screens gets six flags when someone fixes a typo in one
announcement, including on screens whose playlists don't contain any board that
shows announcements.

### Why it is not traversed

The precise version of this is a graph walk: announcement → which widgets read
announcements → which board documents contain those widgets → which playlist items
schedule those boards → which playlists → which screens. It is correct in
principle and wrong in practice, for three reasons.

1. **Every new widget adds an edge.** The graph is not fixed; it grows with the
   widget registry, and plan §5 says adding widget #26 should mean creating one
   folder and nothing else. A traversal makes it mean creating one folder and
   remembering to update the invalidation graph.
2. **A missed edge is invisible.** Over-invalidating costs a rebuild. Under-
   invalidating means a screen in a lobby shows last week's davening times and
   nothing anywhere reports an error. That is the exact failure the entire offline
   design in plan §3 exists to prevent, and it would be discovered by a member of
   the shul, not by monitoring.
3. **Half the edges aren't in the database anyway.** With the board document in
   `jsonb`, "which widgets read announcements" is a property of the widget
   manifests in the codebase, not of a foreign key. A traversal would have to
   reimplement the widget registry inside the invalidation logic and keep the two
   in step forever.

### Why over-invalidation is cheap

The build job hashes the payload and compares it to the stored `content_hash`
(§9). A rebuild that produces identical content updates `built_at` and stops —
`version` doesn't move, `payload` isn't rewritten, and no screen refetches or
cross-fades. So the cost of a spurious rebuild is server CPU for one build, and
nothing at all at the display. The expensive thing to get wrong was never the
rebuild; it was the refetch, and the hash comparison already prevents that.

### Mechanics

- A shared `request_org_rebuild()` trigger function, fired `after insert or update
  or delete` on every content table: `announcements`, `schedules`, `people`,
  `boards`, `playlists`, `playlist_items`, `albums`, `album_items`, `assets`,
  `calendar_events`, `screens`, and `orgs` (for theme changes). Adding a new
  content table means adding the trigger — one line, and its absence is the only
  way to reintroduce staleness.
- The flag is a timestamp, not a counter or a queue row, so a hundred writes in a
  second coalesce into one rebuild for free. No debouncing logic is needed
  anywhere.
- The worker selects screens where `rebuild_requested_at is not null`, oldest
  first, off the partial index.
- **The race that matters:** capture `rebuild_requested_at` at the start of the
  build and, on success, clear it only if it hasn't changed. If someone edited
  content while the build was running, the flag has a newer timestamp, it stays
  set, and the screen rebuilds again. Clearing unconditionally drops that edit
  until the next unrelated change — a stale screen with no error, which is the
  failure mode this whole section is written to avoid.
- On failure, leave `rebuild_requested_at` set, increment `rebuild_attempts`, and
  back off on that count. The previous bundle keeps serving throughout.
- Realtime `bundle_changed` on channel `screen:<id>` is published after a build
  that actually bumped `version`, never after a no-op rebuild. The 60-second
  polling fallback in plan §3d works off the same ETag and needs no separate
  signal.

### The one thing to watch

Not the invalidation, which is settled — the *queue*. A large org editing content
repeatedly enqueues its full screen count each time, and rebuilds are the
expensive operation because each one resolves 90 days of zmanim and 60 days of
anniversaries. If that ever becomes a problem, the fix is worker concurrency
limits and per-screen rate limiting on rebuilds, not narrowing what gets
invalidated. Open question 17 tracks it.

---

## 11. Audit log

### audit_log

Who changed the announcement (plan §8). Cheap now, valuable the first time a shul
asks.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint generated always as identity, pk | High-volume append-only; a uuid PK costs index size for nothing. |
| `org_id` | uuid not null | |
| `actor_kind` | `audit_actor_kind` not null default `'user'` | |
| `actor_user_id` | uuid null → `auth.users(id)` on delete set null | Null for `system` and `share_link` actors. Nullable on purpose: deleting a user must not delete the record of what they did. |
| `action` | text not null | `create`, `update`, `delete`, `publish`, `rotate_token`, `invite`, `accept_invite`, … Text, not an enum — this list will grow with every feature. |
| `entity_table` | text not null | |
| `entity_id` | uuid null | Null for actions that aren't about one row. |
| `summary` | text null | Human-readable, written by the caller: "Changed Mincha from 7:15 to 7:20". This is what the UI shows; `changed` is for when someone needs the detail. |
| `changed` | jsonb null | Old and new values **for changed keys only**, never whole rows. |
| `ip` | inet null | |
| `user_agent` | text null | |
| `created_at` | timestamptz not null default now() | No `updated_at`. Audit rows are never updated. |

**Keys and indexes**

- pk `(id)`
- index `(org_id, created_at desc)` — the org's activity feed
- index `(org_id, entity_table, entity_id, created_at desc)` — "what happened to
  this announcement"

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `has_org_role_at_least(org_id, 'admin')` | — |
| insert / update / delete | *no policy* | *no policy* |

Select is `admin`, not member: `changed` can contain anything from any table,
including names and dates out of `people`, so the log inherits the sensitivity of
the most sensitive thing it records. No write policies at all — rows are written by
`security definer` triggers and by server routes, both of which bypass RLS. That
also means no client can delete or edit an audit row, which is most of what makes
it an audit log rather than a changelog.

Open question 18 covers what gets logged and for how long.

---

## 12. Helper functions

Four functions plus two trigger functions.

### is_org_member(org uuid) → boolean

Returns true when the calling user has any membership row in `org`.

- `security definer`, owned by `postgres`
- `stable` — not `volatile`. This lets the planner call it once per statement in
  many shapes instead of once per row, and it is the single largest performance
  lever in the whole policy set.
- `set search_path = ''` — every reference inside is schema-qualified. A
  `security definer` function without a pinned `search_path` is a privilege
  escalation waiting for someone to create a shadowing table.
- `revoke execute from public, anon; grant execute to authenticated`
- Body: existence check against `public.org_members` where `org_id = org` and
  `user_id = (select auth.uid())`.

**`security definer` is load-bearing, not decorative.** It is what lets a policy on
`org_members` call a function that reads `org_members` without recursing forever.
Removing it produces an infinite-recursion error at query time, not at definition
time, so it survives review and fails in production.

### has_org_role_at_least(org uuid, min_role text) → boolean

Renamed from `has_org_role`. Returns true when the caller's role in `org` ranks at
or above `min_role`, where **owner (4) > admin (3) > editor (2) > viewer (1)** —
confirmed as the intended semantics.

Same attributes as above: `security definer`, `stable`, pinned `search_path`,
execute granted only to `authenticated`.

The name now states the semantics at every call site. `has_org_role(org,
'editor')` read like an equality test while behaving like a comparison, which is
exactly the kind of thing that gets "corrected" during a later review;
`has_org_role_at_least(org, 'editor')` cannot be misread. Every policy in this
document uses the new name.

One property of the `(uuid, text)` signature still needs care: a typo —
`'admins'`, `'Editor'` — is a runtime value, not a compile-time error, and the
natural failure mode of an unrecognized string is "returns false", which silently
locks people out of their own data. The body should `raise exception` on an
unrecognized role rather than return false, so a typo in a policy fails loudly the
first time it is hit.

### current_org_ids() → setof uuid

Returns every org the caller belongs to. Same attributes.

An optimization escape hatch, not a requirement. A policy written as `org_id in
(select current_org_ids())` is planned as a single InitPlan evaluated once per
statement, whereas `is_org_member(org_id)` can be evaluated per row on a
sequential scan. Start with `is_org_member(org_id)` everywhere for readability and
switch only what measures badly. With the board document collapsed into one row
per board, the tables large enough to care are now `audit_log` and
`calendar_events`.

### request_org_rebuild() → trigger

Sets `rebuild_requested_at = now()` on every screen in the affected org. Attached
to every content table. §10 is the full description; the function itself is four
lines and must stay that way — any conditional logic inside it is the beginning of
the traversal §10 rejects.

### set_updated_at() → trigger

Sets `new.updated_at = now()`. A `before update` trigger on every table with an
`updated_at`. Unglamorous, but application-maintained timestamps drift the moment
anything writes outside the app.

---

## 13. Policy strategy

**Deny by default, everywhere.** Enable and force RLS on every table in `public`,
in the same migration that creates the table (CLAUDE.md). A table with RLS enabled
and no policy denies everything, which is the correct starting state.
`screen_bundles`, `screen_heartbeats`, `calendar_events`, `audit_log` and
`zmanim_cache` stay in that state for writes permanently — all five are written
only by trusted server code holding the service role.

**Four policies per table, not one `for all`.** Reads and writes need different
role thresholds — every member reads, only editors write — and a single `for all`
policy cannot express that. Writing them separately also means a `with check`
clause exists on inserts and updates, which is where the tenant boundary is
actually enforced on writes.

**Every write policy has a `with check`, and it names `org_id`.** A `using` clause
alone stops you reading someone else's row; it does not stop you *moving* your row
into their org by updating `org_id`. The `with check` on update must re-assert
`has_org_role_at_least(org_id, …)` against the *new* value.

**Role thresholds.** Derived from plan §8 — admin owns screens and members, editor
owns boards and content.

| | viewer | editor | admin | owner |
|---|---|---|---|---|
| Read anything in the org | ✓ | ✓ | ✓ | ✓ |
| Boards, playlists, notices, schedules, people, media | | ✓ | ✓ | ✓ |
| Delete people | | | ✓ | ✓ |
| Screens, tokens, pairing codes | | | ✓ | ✓ |
| Members and invites | | | ✓ | ✓ |
| Calendar connections | | | ✓ | ✓ |
| Read the audit log | | | ✓ | ✓ |
| Delete the org, billing | | | | ✓ |

**Denormalized `org_id` on every tenant table is the core performance decision.**
The alternative — a policy on `album_items` that joins up through `albums` to check
membership — evaluates a correlated subquery per row, and Postgres will not always
hoist it. With `org_id` present, the predicate is a function call against a column
already in the row and the table's `org_id` index does the rest. The composite
`(parent_id, org_id)` foreign keys described in §1 are what make this safe rather
than a consistency hazard.

**Wrap `auth.uid()` in a scalar subquery.** `(select auth.uid())` rather than
`auth.uid()`. Postgres treats the subquery form as a one-time InitPlan and the bare
call as a per-row expression. It looks like a stylistic tic and it is worth a large
constant factor on any scan.

**Index every `org_id`.** A policy that can't use an index turns every list query
into a full scan that also runs a function per row.

**The `anon` role gets nothing.** No policy anywhere grants it. The display route
holds no session at all; it authenticates a token in a server route and reads with
the service role, which bypasses RLS by design (plan §8).

**Realtime is a second policy surface.** Supabase Realtime authorizes Postgres
changes subscriptions through these same policies, so a display client subscribing
directly would need anon access this schema deliberately doesn't grant. Screens
receive `bundle_changed` over a broadcast channel and refetch through the server
route.

**Storage is a third.** Covered under `assets` — `storage.objects` needs policies
mirroring this schema's, keyed on the org id in the object path.

### Where the policies carry performance risk

The two sharpest edges in the first draft are both gone: `board_widgets` no longer
exists, so a board loads as a single primary-key lookup, and `screen_heartbeats`
is sixty times smaller. What remains:

1. **The `org_members` lookup runs on every single query in the app.** Both
   helpers hit it. If `(user_id, org_id) include (role)` is missing, every RLS
   check in the product does a heap fetch. This one index is worth more than any
   other tuning in the schema.
2. **`stable` versus `volatile` on the helpers.** Marking them `volatile` — the
   default if nobody says otherwise — forces per-row evaluation everywhere and
   silently multiplies the cost of every list query. There is no error message for
   this; it just gets slow.
3. **`audit_log` is now the largest table.** It grows without bound, and an
   org-wide activity feed scans it under a per-row function call. The
   `(org_id, created_at desc)` index makes the common query a bounded scan;
   retention (open question 18) is what keeps it that way.
4. **`calendar_events` for an org syncing several busy calendars** is the other
   table where row counts get real. The partial index on
   `(org_id, starts_at) where status <> 'cancelled'` is what the builder's 30-day
   read needs; a full-table query for maintenance will be slower and should run
   as the service role, outside RLS.
5. **`screen_bundles.payload` is a large TOASTed value behind an RLS policy.** The
   policy itself is cheap, but any query selecting `payload` when it only needed
   `content_hash` pays full detoast cost. §9 covers the 304 path specifically;
   the general rule is never `select *` from this table.
6. **Soft delete plus RLS.** Policies filter by org, not by `deleted_at`, so every
   application query must remember `where deleted_at is null`. One that forgets
   shows deleted rows to users. Folding `deleted_at is null` into the select policy
   fixes it, but then nothing can ever read a deleted row to restore it. Open
   question 10.
7. **`zmanim_cache`'s select policy is the cheap one and should stay that way.**
   The 90-day bundle read is a primary-key range scan; adding an ownership join
   would put a correlated subquery on the hottest read path in the product.

---

## Open questions

Decided since the first draft and therefore removed: the board document as jsonb
versus a widgets table; `has_org_role_at_least` ranking semantics; whether
`zmanim_cache` is tenant-scoped; how bundles are stored and invalidated; and the
four tables now specified above. Ordered roughly by how expensive they are to get
wrong.

**1. CLAUDE.md now contradicts this schema in two places and should be amended
before the first migration.**
   - *"Every table has `org_id` and an RLS policy."* `zmanim_cache` is confirmed
     shared with no `org_id`, so the rule needs to read "every *tenant* table has
     `org_id` and an RLS policy; shared reference and cache tables have RLS with no
     write policy." Left as-is, the next person to read it will helpfully add an
     `org_id` to the cache and multiply the MyZmanim bill.
   - *"The service-role key never appears in a client component or in `app/s/`"*
     is right, but the accompanying claim that the bundle route is "the ONLY place
     the service-role key is used" is now false four times over: the bundle route
     reads, the build worker writes `screen_bundles`, the heartbeat route upserts
     telemetry, the invite-accept route creates the first membership row, and the
     share-link upload route writes assets. All five are server-only and none is
     reachable from a client component, so the *security* rule holds; the
     *inventory* doesn't. Reword it to enumerate the trusted server surfaces, so
     that adding a sixth is a deliberate act rather than a rule already known to
     be inaccurate.

**2. Screen tokens are stored in plaintext, with no rotation grace period.** They
have to be displayable — the gabbai copies the URL onto a TV — so a one-way hash
doesn't work without keeping the plaintext anyway. The consequence is that a
database read hands an attacker every screen URL in the product, and those URLs
need no auth. Partial mitigations: keep the token out of any view exposed to
`viewer`, log token use, rate-limit the bundle route. Separately, rotating a token
blacks out the TV until someone walks over and retypes the URL; a `screen_tokens`
child table with `revoked_at` would allow overlapping validity. Worth doing if
tokens are ever rotated in practice.

**3. Tables the plan still requires that this pass doesn't cover.** Each needs the
same `org_id` + RLS treatment: `polls` and `poll_votes`, `message_board_posts`
(P7, and the moderation queue is not optional), `subscriptions` / billing state
(P8, see question 4), and a token-use log for the rate limiting plan §8 asks for.

**4. Per-screen or per-org pricing is still open (plan §10.5) and it shapes this
schema.** A nullable `screen_limit` on `orgs` is a placeholder. If pricing is
per-screen, screens need their own billing state — active, suspended, trialing —
and a suspended screen must degrade to a "contact the shul office" board rather
than going black, which is a display-behavior question as much as a schema one.

**5. Asset URLs versus offline screens, now sharper.** Signed Storage URLs expire,
and a screen may be offline for days while rendering from its cached bundle (plan
§3b–3c). With `screen_bundles`, those URLs are *frozen into a stored payload at
build time* — a bundle built on Monday with a 24-hour signature is serving dead
image links on Wednesday even to screens that are perfectly online, because the
hash hasn't changed and nothing triggers a rebuild. Three options: a public bucket
with unguessable paths (simple, but a shul's photos of children become publicly
fetchable), signed URLs with a TTL comfortably longer than the rebuild cadence
plus the maximum tolerable offline window, or a token-scoped media proxy route
that keeps bundle URLs stable and does authorization at fetch time. The third is
the only one that doesn't put an expiry clock inside a cached artifact. Needs
deciding before P5, and it is a privacy decision as much as a technical one.

**6. Hebrew date occurrences: computed or materialized.** Month is stored as text
with explicit `adar_i` / `adar_ii` because numeric months are ambiguous across
leap years, and anniversary occurrences are deliberately not materialized. If
bundle build time makes computing 60 days of yahrzeits per screen too slow — and
§10's org-wide invalidation means builds happen more often than they strictly need
to — a `person_occurrences(person_id, occurs_on, kind)` table generated 20 years
out via the Hebcal anniversary API is the fix. The caveat is that it must be
regenerated whenever a date is corrected, and a stale occurrence row is a yahrzeit
announced on the wrong day, which is the single worst bug this product can have.

**7. `schedules` is flat; it may want to be two tables.** One row per item matches
how the Davening Hours widget reads. But shuls think in named schedules — "summer
weekday", "Shabbos" — and a container plus `schedule_items` would let a whole
seasonal set be swapped by changing one `effective_from` rather than editing twenty
rows. Revisit at P4 when real davening data exists.

**8. The canonical zman IDs have no home in the database.** They appear as
`schedules.zman_id`, as keys inside `zmanim_cache.times`, and inside widget
`config` in `boards.doc`. Three uncoordinated string vocabularies is how
`tzeis_3_stars` becomes `tzeis_3stars` in one of them. Either a `zman_ids` lookup
table with an FK from `schedules`, or accept that the TypeScript union in the
widget layer is the source of truth and add no constraint at all. Half-enforcing
it is the worst option — and note that moving the board document to jsonb removed
the one place a foreign key could have helped.

**9. Fractional `numeric` ordering has a known failure mode.** Repeatedly
inserting between two adjacent items halves the gap and eventually exhausts
precision. A playlist has under twenty items so this never happens in practice,
but flagging it so the choice is deliberate rather than accidental.

**10. Soft delete is inconsistent by design and that's a risk.** Four tables have
`deleted_at`; the rest don't. Every query against those four must remember the
filter and RLS won't remind anyone. Folding `deleted_at is null` into the select
policy makes forgetting impossible but also makes restore impossible without the
service role. My inclination is to fold it in and do restores through a server
route, but it's a real trade.

**11. Nothing prevents privilege escalation within `org_members` yet.** As
written, an `admin` can update their own row to `owner`, and an `admin` can demote
the last `owner`. Both need trigger enforcement: only owners may grant `owner`,
nobody may change their own role, and an org must always retain at least one owner.
These are constraints RLS cannot express, and they are easy to leave for "later"
and never write. `org_invites` already restricts `role <> 'owner'`, which closes
the invite path but not the direct-update one.

**12. There's no notion of an active org.** A user may belong to several, every
policy is org-scoped, and the app carries an org id in every query. That's normal,
but it means org switching lives entirely in application state and a bug there
shows one shul's data under another shul's name. A `user_preferences(user_id,
last_org_id)` table would at least make the default deterministic across devices.

**13. Shared infrastructure with the yeshiva system (plan §10.6) is unresolved and
this schema assumes "separate".** `orgs`, `org_members`, `org_invites` and both
helper functions are exactly the layer that would be shared. If the answer is
"shared", they belong in a common schema with the product tables referencing
across, and that is very hard to retrofit once both products have their own `orgs`
table with different columns. The cheapest question here to answer now and one of
the most expensive to answer late.

**14. `boards.doc` has no referential integrity, and that is new.** Asset and album
ids live inside the document, so nothing stops deleting an album that three boards
render. `playlist_items.board_id` still protects boards from deletion via
`on delete restrict`, but assets and albums lost their equivalent when the widgets
table went away. Two workable answers: query the GIN index before allowing an
album or asset delete and refuse with a list of boards, or accept dangling
references and have the widget renderer show a defined placeholder. The second is
more honest about the failure mode and needs the placeholder specified — a missing
photo on a lobby screen should look deliberate, not broken. Either way, decide it
in P1 rather than discovering it in P5.

**15. Whole-document writes make concurrency coarser and amplify writes.**
`doc_version` optimistic concurrency now guards the entire board: two people
editing different widgets on the same board conflict, where per-row storage would
have let them through. More practically, a 1s-debounced autosave rewrites and
re-TOASTs the whole document on every keystroke pause, so a large board is a lot of
WAL for a small edit. Neither is a reason to reverse the decision — the editor is
single-user in practice and boards are small — but a maximum widget count and a
maximum document size should be picked in P1 and enforced in the zod schema, so
the ceiling is a validation error rather than a performance mystery.

**16. Document schema versioning needs an upgrade-on-read path.** `schema_version`
is in the document from the first write, but nothing yet says what happens when
the shape changes: whether `parseBoardDoc()` migrates old versions on read and
rewrites lazily on next save, or whether a batch job rewrites every board. Lazy
migration is usually right and means the renderer must handle every historical
version it might meet, which is a maintenance cost worth accepting knowingly.

**17. Rebuild queue behavior at scale — not the invalidation, the worker.** §10 is
settled and deliberately over-eager. What is not specified is what happens when a
large org edits content in a tight loop: each write flags every screen, and each
rebuild resolves 90 days of zmanim and 60 days of anniversaries. The likely answer
is worker concurrency limits plus a minimum interval between rebuilds of the same
screen, both of which preserve correctness because the flag is a timestamp that
survives until a build clears it. Explicitly *not* a licence to narrow what gets
invalidated.

**18. What the audit log records, and for how long.** Every table or a subset;
`changed` diffs on every update or only on the tables a shul would ask about;
retention, given that the log inherits the sensitivity of `people`. Unbounded
growth also makes it the largest table in the schema now that heartbeats are
bucketed. A year of retention with the diff omitted for high-churn tables is a
reasonable starting point, but it should be a decision rather than a default.

**19. Recurring calendar events are stored expanded, which has a horizon.**
Instances exist only as far ahead as the sync window, so a bundle asking for 30
days needs the sync to stay comfortably ahead of that. Two consequences to
confirm: what happens to a series edited retroactively — expanded instances must
be reconciled, not just upserted, or cancelled occurrences linger — and whether
the "next event" widget can ever need to look past the expansion horizon. Storing
masters plus recurrence rules avoids both but requires an RRULE expander at build
time.
