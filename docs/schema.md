# Data model proposal

Companion to `plan.md` §1, §8, §9. This is a proposal, not a migration — no SQL
here. Read the open questions at the end before anyone writes the first
migration, because four or five of them change the shape of a table rather than
just a column.

Target: Supabase Postgres. Every statement below assumes RLS is on and forced.

---

## 1. Conventions

These hold for every table unless the table's own section says otherwise.

- **Primary keys** are `uuid`, defaulted from `gen_random_uuid()`. One
  exception: `screen_heartbeats` uses a `bigint` identity because it's
  high-volume append-only and a uuid PK there costs index size for nothing.
- **`org_id uuid not null`** on every tenant table, referencing `orgs(id)` with
  `on delete cascade`. It is *denormalized onto every child table*, including
  grandchildren like `board_widgets` and `album_items`. This is the single most
  important decision in the whole document and §11 explains why.
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
  question 12; soft delete interacts badly with RLS and I'd rather have it on
  four tables than fourteen.
- **Text, not varchar.** No length limits in the type; use check constraints
  where a real limit exists.
- **Percentages** are `numeric(6,3)`, giving three decimals of a percent — about
  0.02px of precision on a 1920px canvas. Ample, and exact, which `real` is not.
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
| `org_role` | `owner`, `admin`, `editor`, `viewer` | Ordered by privilege. §10 ranks them. |
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
| `sync_status` | `never`, `ok`, `error` | |
| `person_gender` | `male`, `female`, `unspecified` | Needed for ben/bat construction and Hebrew grammar, not for anything else. |
| `upload_source` | `dashboard`, `share_link` | |

**Not an enum:** the canonical zman IDs (`alos_72`, `netz`, `sof_zman_shma_gra`,
…). Seventeen values that will grow, referenced from jsonb config as well as from
columns. Use `text` with a check against a `zman_ids` lookup table, or no
constraint at all and validate in the widget's zod schema. See open question 10.

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
| `screen_limit` | integer null | Null = unlimited. See open question 5. |
| `created_by` | uuid null → `auth.users(id)` | |
| `created_at` / `updated_at` | timestamptz not null | |
| `deleted_at` | timestamptz null | Owner-only soft delete. |

**Keys and indexes**

- pk `(id)`
- unique `(slug)`
- unique `(id, org_id)` is meaningless here; instead every child FKs to
  `orgs(id)` directly.
- index on `(deleted_at)` where null, if org counts ever get large. Not needed at
  launch.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(id)` | — |
| insert | — | `created_by = (select auth.uid())` |
| update | `has_org_role(id, 'admin')` | `has_org_role(id, 'admin')` |
| delete | `has_org_role(id, 'owner')` | — |

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
| `created_at` | timestamptz not null | |
| `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(org_id, user_id)` — no surrogate key; the pair *is* the identity.
- index `(user_id, org_id)` — **this one is load-bearing.** Both helper functions
  probe by `user_id` first, and the PK index leads with `org_id`, so without this
  index every RLS check is a scan. Include `role` in the index (or make it
  covering) so `has_org_role` is an index-only lookup.
- Partial unique index enforcing at least one owner per org is not expressible
  directly; use a `before delete`/`before update` trigger that refuses to remove
  the last `owner`.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role(org_id, 'admin')` |
| update | `has_org_role(org_id, 'admin')` | `has_org_role(org_id, 'admin')` |
| delete | `has_org_role(org_id, 'admin')` or `user_id = (select auth.uid())` | — |

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
update policy only checks org membership rank. Add a check constraint or trigger
that only an `owner` may write the value `owner`, and that nobody may change
their own role.

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
| `bundle_version` | integer not null default 1 | Bumped on any change affecting this screen. The display polls and compares. |
| `last_seen_at` | timestamptz null | Denormalized from heartbeats. See §9 for why this column exists. |
| `last_seen_bundle_version` | integer null | Lets the dashboard say "showing a version from Tuesday". |
| `last_seen_board_id` | uuid null | The "Showing" column in the screens view. |
| `is_active` | boolean not null default true | |
| `created_at` / `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)` for child composite FKs
- **unique `(token)`** — the display route's only lookup. Must be unique globally,
  not per org.
- unique `(pairing_code)` partial, where `pairing_code is not null`
- index `(org_id)` — every RLS-filtered list query starts here
- index `(playlist_id)`
- index `(org_id, last_seen_at desc)` for the screens view's status sort

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role(org_id, 'admin')` |
| update | `has_org_role(org_id, 'admin')` | `has_org_role(org_id, 'admin')` |
| delete | `has_org_role(org_id, 'admin')` | — |

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
| insert | — | `has_org_role(org_id, 'editor')` |
| update | `has_org_role(org_id, 'editor')` | `has_org_role(org_id, 'editor')` |
| delete | `has_org_role(org_id, 'admin')` | — |

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
| `priority` | integer not null default 0 | Higher wins. This is the event-takeover mechanism (plan §6 phase). |
| `is_enabled` | boolean not null default true | |
| `created_at` / `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(id)`
- unique `(playlist_id, position)`
- index `(playlist_id, position)` — the bundle builder's read path
- index `(board_id)` — to answer "is this board in use" before allowing a delete
- index `(org_id)`

`on delete restrict` on `board_id` is intentional: deleting a board that is
scheduled on a live screen should fail loudly and tell the user which playlist
holds it, rather than silently emptying a rotation.

**RLS** — identical to `playlists`: select for members, write for `editor`,
delete for `editor` (deleting an item is not the destructive case; deleting the
board is).

---

## 5. Boards

### boards

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `name` | text not null | "Weekday board" |
| `canvas_width` / `canvas_height` | integer not null, default 1920 / 1080 | Design units. Widget positions are percentages *of these*. |
| `background` | jsonb not null default `'{}'` | Token reference or asset reference. Never a raw hex — see CLAUDE.md. |
| `theme_overrides` | jsonb not null default `'{}'` | Deviations from the org theme. |
| `doc_version` | integer not null default 1 | Optimistic concurrency for the 1s-debounced autosave. A save carrying a stale `doc_version` is rejected rather than silently overwriting a second editor. |
| `is_template` | boolean not null default false | The templates gallery in P8. |
| `template_category` | text null | |
| `created_by` / `updated_by` | uuid null | |
| `created_at` / `updated_at` | timestamptz not null | |
| `deleted_at` | timestamptz null | |

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)`
- index `(org_id)` where `deleted_at is null`
- index `(org_id, is_template)` for the gallery

No stored thumbnail column. `design.md` specifies the screens-view thumbnail as a
real render through the shared widget renderer, so a cached image would be a
second source of truth that goes stale. If render cost forces a cache later, it
belongs in `assets`, not as a column here.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role(org_id, 'editor')` |
| update | `has_org_role(org_id, 'editor')` | `has_org_role(org_id, 'editor')` |
| delete | `has_org_role(org_id, 'editor')` | — |

### board_widgets

One row per widget instance on a board. **Position is percentage of canvas, never
pixels** (CLAUDE.md hard rule, plan §4a).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `board_id` | uuid not null | Composite FK `(board_id, org_id)`, on delete cascade. |
| `widget_type` | text not null | Matches the `id` in `widgets/<name>/manifest.ts`. Not an enum — adding widget #26 must be a folder and nothing else. |
| `x` | numeric(6,3) not null | Percent of `canvas_width`, left edge. |
| `y` | numeric(6,3) not null | Percent of `canvas_height`, top edge. |
| `w` | numeric(6,3) not null | Percent of `canvas_width`. Check `> 0`. |
| `h` | numeric(6,3) not null | Percent of `canvas_height`. Check `> 0`. |
| `rotation` | numeric(6,3) not null default 0 | Degrees. Check `>= -360 and <= 360`. |
| `z_index` | integer not null default 0 | |
| `group_id` | uuid null → `board_widgets(id)` on delete set null | Self-reference for group/ungroup. |
| `is_locked` | boolean not null default false | |
| `is_hidden` | boolean not null default false | |
| `opacity` | numeric(4,3) not null default 1 | Check `between 0 and 1`. |
| `config` | jsonb not null default `'{}'` | Validated against the widget's zod `settingsSchema` in the app layer. |
| `style_overrides` | jsonb not null default `'{}'` | Per-instance theme deviation (plan §4d). |
| `created_at` / `updated_at` | timestamptz not null | |

**The pixel guard.** Add a check constraint that `x`, `y`, `w`, `h` all fall
between -100 and 200. Widgets legitimately hang off the canvas edge, so a plain
0–100 range is too tight, but a stray pixel value like `960` fails immediately and
loudly. This constraint exists purely to make the CLAUDE.md rule enforceable by
the database rather than by code review, and it's worth the two minutes.

**Keys and indexes**

- pk `(id)`
- index `(board_id, z_index)` — the render order read path, covers the editor and
  the bundle builder
- index `(org_id)`
- gin index on `config` — needed to answer "which widgets bind to album X" before
  allowing an album delete, and "which widgets use provider Y" for the divergence
  warning in plan §5c

**RLS** — same four policies as `boards`. Select for members; insert, update, and
delete for `editor`.

Note the volume asymmetry: this is the first table where a single org can hold
tens of thousands of rows and where the RLS function runs per row on a scan. §11
covers the mitigation.

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
  queue and the "still uploading" UI
- index `(org_id, moderation_status)` partial where `'pending'` — the moderation
  queue

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role(org_id, 'editor')` |
| update | `has_org_role(org_id, 'editor')` | `has_org_role(org_id, 'editor')` |
| delete | `has_org_role(org_id, 'editor')` | — |

**Storage needs its own policies.** RLS on this table protects the metadata, not
the bytes. `storage.objects` needs a parallel set of policies keyed on the first
path segment of `name` being an org the user belongs to. Getting one right and
forgetting the other is the most common way a multi-tenant Supabase app leaks
files. Share-link uploads bypass both by going through a server route with the
service role, exactly like the bundle route.

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
| `share_token` | text null | The `/u/<token>` upload link (plan §6, still an open decision for v1). |
| `share_enabled` | boolean not null default false | |
| `share_expires_at` | timestamptz null | |
| `moderation_required` | boolean not null default true | If the share link is on, this should not be off by default. |
| `created_at` / `updated_at` | timestamptz not null | |

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)`
- unique `(share_token)` partial, where not null
- index `(org_id)`

**RLS** — select for members; insert and update for `editor`; delete for
`editor`. The `share_token` column is readable by any member, which is correct —
a viewer who can see the album can share the upload link.

### album_items

Many-to-many. An asset belongs to any number of albums.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `album_id` | uuid not null | Composite FK, on delete cascade. |
| `asset_id` | uuid not null | Composite FK, on delete cascade. |
| `position` | numeric not null | Fractional, same scheme as `playlist_items`. |
| `caption` | text null | Per-album caption override; falls back to `assets.caption`. |
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
yahrzeit lookahead query filters on month and day. A `text` column reading
`'23 Elul'` cannot be indexed usefully for "everyone in the next 60 days".

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | |
| `first_name` | text null | |
| `last_name` | text null | |
| `display_name` | text not null | What actually appears on the board. Explicit, not computed — "R' Yosef Cohen" is not derivable from the parts. |
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
| `commemorated_by` | text null | "The Cohen family" — what the board actually prints under a yahrzeit. |
| `photo_asset_id` | uuid null | Composite FK, on delete set null. |
| `show_on_boards` | boolean not null default true | A person can be recorded without being displayed. |
| `notes` | text null | |
| `created_by` / `updated_by` | uuid null | |
| `created_at` / `updated_at` | timestamptz not null | |
| `deleted_at` | timestamptz null | |

**Constraints**

- Check that at least one of `birth_date_gregorian`, `birth_hebrew_day`,
  `death_date_gregorian`, `death_hebrew_day` is present. A person row with no date
  is a contact, not a bulletin-board entry.
- Check that the Hebrew triple is all-or-nothing: year, month and day are either
  all null or all present, for each of birth and death.

**Keys and indexes**

- pk `(id)`, unique `(id, org_id)`
- index `(org_id, death_hebrew_month, death_hebrew_day)` partial where
  `death_hebrew_day is not null` — the yahrzeit lookahead
- index `(org_id, birth_hebrew_month, birth_hebrew_day)` partial where not null
- index `(org_id, birth_date_gregorian)` for shuls that run Gregorian birthdays
- index `(org_id)` where `deleted_at is null`

**No materialized occurrence rows.** The 60-day lookahead is computed at bundle
build time from the Hebrew month and day via `@hebcal/core` and the Hebcal
anniversary API, not stored. A `person_occurrences` table would need regenerating
every year and would drift silently when someone corrects a date. Open question 8
revisits this if bundle build time becomes a problem.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role(org_id, 'editor')` |
| update | `has_org_role(org_id, 'editor')` | `has_org_role(org_id, 'editor')` |
| delete | `has_org_role(org_id, 'admin')` | — |

Delete is `admin` here, unlike the other content tables. This is the one table
holding family and death records, and a mis-click is not recoverable from a
gabbai's memory.

### announcements

Called "notices" everywhere in the UI (`design.md` §4). The table keeps the
longer name; the interface does not.

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
- index `(org_id, starts_at, ends_at)` partial where `status = 'published'` — this
  is the bundle builder's only query against this table, so make it the only index
  that matters
- index `(org_id, status, updated_at desc)` for the dashboard list

**RLS** — select for members, all writes for `editor`.

### schedules

Davening times and shiurim. One row per recurring item ("Shacharis, weekdays,
7:00"), not one row per named schedule. See open question 9 for the alternative.

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
| `applies_on` | jsonb not null default `'{}'` | Shabbos, yom tov, rosh chodesh, fast days, chol hamoed — the flags a weekday bitmask can't express. |
| `effective_from` | date null | Seasonal Mincha. |
| `effective_to` | date null | |
| `location_note` | text null | "Beis medrash" |
| `position` | numeric not null | Display order within the widget. |
| `is_active` | boolean not null default true | |
| `notes` | text null | |
| `created_by` / `updated_by` | uuid null | |
| `created_at` / `updated_at` | timestamptz not null | |

**Constraints**

- Check that `time_kind = 'fixed'` implies `fixed_time is not null`, and
  `time_kind = 'zman_relative'` implies `zman_id is not null`. Exactly one of the
  two shapes, enforced.
- Check `days_of_week` values are all between 0 and 6.

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

- pk `(id)`
- unique `(org_id, provider, calendar_id)` — connecting the same calendar twice
  is always a mistake
- index `(org_id)`
- index `(sync_status, last_synced_at)` for the sync worker's queue

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | — | `has_org_role(org_id, 'admin')` |
| update | `has_org_role(org_id, 'admin')` | `has_org_role(org_id, 'admin')` |
| delete | `has_org_role(org_id, 'admin')` | — |

**RLS does not protect columns.** If the refresh token were a column here, every
`viewer` in the org could select it, because RLS filters rows and nothing else.
Two ways out, and the schema above takes the first:

1. Keep the secret out of the table. Store it in Supabase Vault and hold only
   `vault_secret_id`. The sync worker reads Vault with the service role; the
   client never can.
2. Keep the column but `revoke select (refresh_token) from authenticated` and
   expose a `security_invoker` view without it. This works, but column grants are
   easy to lose in a later migration and nothing fails loudly when you do.

Where the fetched events live is open question 4 — there is no `calendar_events`
table in this pass, and the bundle needs one.

---

## 8. Shared cache — not tenant-scoped

### zmanim_cache

**This table has no `org_id` and is not tenant-scoped.** That is deliberate and
it is the entire point: twenty Crown Heights shuls resolve to the same
`location_id`, so one API call and one row serves all of them (plan §5c). Adding
`org_id` here would multiply MyZmanim's per-location billing by the number of
customers in a neighborhood.

It is also the one table that contradicts CLAUDE.md's "every table has `org_id`"
rule, and the rule should be reworded to "every *tenant* table" rather than this
table being bent to fit it. See open question 1.

| Column | Type | Notes |
|---|---|---|
| `provider` | `zmanim_provider` not null | |
| `location_id` | text not null | Provider-namespaced. MyZmanim's internal `LocationID`; for Hebcal, a derived key such as `geo:40.669,-73.943` rounded to a fixed precision so nearby shuls collide on purpose. |
| `date` | date not null | Local calendar date at that location. |
| `timezone` | text not null | IANA name. Needed to interpret the times below. |
| `times` | jsonb not null | Canonical zman id → `{ "iso": "...", "display": "6:42 pm" }`. **Both.** The plan forbids re-rounding or recomputing provider output, so the provider's own rendered string is stored verbatim and displayed verbatim; the ISO value exists for countdowns and sorting only. |
| `raw_response` | jsonb null | The provider's untouched payload. Worth the bytes: Chabad.org's endpoint is undocumented and will change shape without notice, and this is the only way to diagnose it after the fact. |
| `fetched_at` | timestamptz not null default now() | |
| `source_version` | text null | Adapter version, so a mapping bug can be identified and those rows re-fetched. |

**Keys and indexes**

- **pk `(provider, location_id, date)`** — exactly as the plan specifies. The
  bundle's 90-day read is a range scan on this index and needs nothing else.
- index `(fetched_at)` for the pruning job.
- No partitioning. Even 500 locations × 4 providers × 400 days is under a million
  rows; a nightly delete of rows older than ~30 days keeps it small. Partitioning
  here would be premature.

**RLS**

RLS is still enabled, with exactly one policy:

| Command | `using` | `with check` |
|---|---|---|
| select | `(select auth.role()) = 'authenticated'` | — |
| insert / update / delete | *no policy* | *no policy* |

No write policy means no client can write, ever. The cache-warming cron and the
bundle builder use the service role, which bypasses RLS entirely. The select
policy exists so the zmanim settings UI can preview real times for the org's
location while the gabbai is picking rows.

One caveat worth naming: any authenticated user can read every cached location,
which weakly leaks the set of neighborhoods with customers. If that matters,
restrict select to rows whose `location_id` appears on some screen the user's orgs
own — but that turns a PK lookup into a join, on the hottest read path in the
product. I'd take the leak.

---

## 9. Telemetry

### screen_heartbeats

Append-only. A screen POSTs every 60 seconds (plan §3e), so this is by far the
highest-volume table: one screen produces ~1,440 rows a day, and fifty screens
produce ~26 million rows a year.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint generated always as identity, pk | Not uuid. At this volume the index size difference is real. |
| `org_id` | uuid not null | Denormalized from the screen so the RLS policy never joins. |
| `screen_id` | uuid not null | Composite FK `(screen_id, org_id)`, on delete cascade. |
| `created_at` | timestamptz not null default now() | |
| `bundle_version` | integer null | What the screen is *actually* running. Compared against `screens.bundle_version` this detects a screen stuck on an old bundle — a failure mode that otherwise looks like a working screen. |
| `board_id` | uuid null | What it's currently showing. Feeds the "Showing" column. |
| `app_version` | text null | |
| `user_agent` | text null | Which TV browser, for the inevitable support call. |
| `ip` | inet null | See the retention note. |
| `viewport_width` / `viewport_height` | integer null | Catches a 4K screen running a 1080p board. |
| `uptime_seconds` | integer null | Confirms the 3am self-reload is happening. |
| `error_count` | integer not null default 0 | From the global error boundary. |
| `last_error` | text null | |

**Keys and indexes**

- pk `(id)`
- index `(screen_id, created_at desc)` — the only query anyone runs against the
  history
- index `(created_at)` for the retention job
- **Not** an index on `(org_id)` alone; it would be enormous and low-selectivity.
  The composite above serves the RLS-filtered reads because `screen_id` is always
  in the predicate.

**Retention.** Delete rows older than 7 days on a cron. Two reasons: the table
becomes the largest object in the database within months otherwise, and `ip` plus
`user_agent` on a 60-second cadence is a movement log of a physical building that
nobody asked to keep. If longer history is wanted, roll up to hourly
min/max/count rows and drop the raw ones.

**The denormalized column on `screens`.** `screens.last_seen_at`,
`last_seen_bundle_version`, and `last_seen_board_id` are updated by the same
server route that inserts the heartbeat. The screens view — the product's
identity view per `design.md` §4 — then renders from a single indexed scan of
`screens` instead of a lateral join against millions of heartbeat rows evaluated
under an RLS function. This denormalization is not an optimization to add later;
without it the most-visited page in the app degrades as the product succeeds.

**RLS**

| Command | `using` | `with check` |
|---|---|---|
| select | `is_org_member(org_id)` | — |
| insert | *no policy* | *no policy* |
| update / delete | *no policy* | *no policy* |

No insert policy is not an oversight. The heartbeat comes from `/s/[token]`,
which has no session and no auth — there is no `auth.uid()` to write a policy
against. It posts to a server route that validates the token and inserts with the
service role, exactly like the bundle route. A client-writable heartbeat table
would let anyone forge liveness for any screen.

---

## 10. Helper functions

Four functions. The first two are required by plan §8; the others are the
machinery that makes the policies cheap and consistent.

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

**`security definer` is load-bearing, not decorative.** It is what lets a policy
on `org_members` call a function that reads `org_members` without recursing
forever. Removing it produces an infinite-recursion error at query time, not at
definition time, so it survives review and fails in production.

### has_org_role(org uuid, min_role text) → boolean

Returns true when the caller's role in `org` is *at least* `min_role`, ranked
`viewer` 1 < `editor` 2 < `admin` 3 < `owner` 4.

Same attributes as above: `security definer`, `stable`, pinned `search_path`,
execute granted only to `authenticated`.

Two notes on the signature, which plan §8 fixes as `(uuid, text)`:

- **It ranks, it doesn't match.** `has_org_role(org, 'editor')` is true for an
  admin and an owner. If it were an exact match, every policy would need to list
  three roles and adding a fifth role later would mean editing every policy in the
  database. Open question 14 records the alternative reading.
- **`text` is lossy.** A typo — `'admins'`, `'Editor'` — is a runtime value, not a
  compile-time error, and the natural failure mode of an unrecognized string is
  "returns false", which silently locks people out of their own data. The body
  should therefore `raise exception` on an unrecognized role rather than return
  false, so a typo in a policy fails loudly the first time it's hit. Taking
  `org_role` instead of `text` would remove the problem entirely, at the cost of
  diverging from the plan.

### current_org_ids() → setof uuid

Returns every org the caller belongs to. Same attributes.

Not in the plan, and not required — it's an optimization escape hatch. A policy
written as `org_id in (select current_org_ids())` is planned as a single
InitPlan evaluated once per statement, whereas `is_org_member(org_id)` can be
evaluated per row on a sequential scan. On `board_widgets` and
`screen_heartbeats` that difference is measurable. Start with
`is_org_member(org_id)` everywhere for readability, and switch only the tables
that measure badly.

### set_updated_at() → trigger

Sets `new.updated_at = now()`. A `before update` trigger on every table with an
`updated_at`. Unglamorous, but application-maintained timestamps drift the moment
anything writes outside the app — a migration, a support query, the sync worker.

---

## 11. Policy strategy

**Deny by default, everywhere.** `alter table … enable row level security` plus
`force row level security` on every table in `public`, in the same migration that
creates the table (CLAUDE.md). A table with RLS enabled and no policy denies
everything, which is the correct starting state; `screen_heartbeats` inserts and
all `zmanim_cache` writes stay in that state permanently.

**Four policies per table, not one `for all`.** Reads and writes need different
role thresholds — every member reads, only editors write — and a single `for all`
policy cannot express that. Writing them separately also means a `with check`
clause exists on inserts and updates, which is where the tenant boundary is
actually enforced on writes.

**Every write policy has a `with check`, and it names `org_id`.** A `using`
clause alone stops you reading someone else's row; it does not stop you *moving*
your row into their org by updating `org_id`. The `with check` on update must
re-assert `has_org_role(org_id, …)` against the *new* value.

**Role thresholds.** Derived from plan §8 — admin owns screens and members,
editor owns boards and content.

| | viewer | editor | admin | owner |
|---|---|---|---|---|
| Read anything in the org | ✓ | ✓ | ✓ | ✓ |
| Boards, widgets, playlists, notices, schedules, people, media | | ✓ | ✓ | ✓ |
| Delete people | | | ✓ | ✓ |
| Screens, tokens, pairing codes | | | ✓ | ✓ |
| Members and invites | | | ✓ | ✓ |
| Calendar connections | | | ✓ | ✓ |
| Delete the org, billing | | | | ✓ |

**Denormalized `org_id` on every child table is the core performance decision.**
The alternative — a policy on `board_widgets` that joins up through `boards` to
check membership — evaluates a correlated subquery per row, and Postgres will not
always hoist it. With `org_id` present, the predicate is a function call against a
column already in the row and the table's `org_id` index does the rest. The
composite `(parent_id, org_id)` foreign keys described in §1 are what make this
safe rather than a consistency hazard.

**Wrap `auth.uid()` in a scalar subquery.** `(select auth.uid())` rather than
`auth.uid()`. Postgres treats the subquery form as a one-time InitPlan and the
bare call as a per-row expression. It looks like a stylistic tic and it is worth
a large constant factor on any scan.

**Index every `org_id`.** A policy that can't use an index turns every list query
into a full scan that also runs a function per row.

**The `anon` role gets nothing.** No policy anywhere grants it. The display route
holds no session at all; it authenticates a token in a server route and reads with
the service role, which bypasses RLS by design (plan §8). That service-role key
appears in exactly one place, `app/api/screen/[token]/bundle/`, and CLAUDE.md
already forbids it from `app/s/` and any client component.

**Realtime is a second policy surface.** Supabase Realtime authorizes Postgres
changes subscriptions through the same RLS policies, so a display client
subscribing directly would need anon access this schema deliberately doesn't
grant. Screens receive `bundle_changed` over a broadcast channel and refetch
through the server route; the widget-level realtime in plan §3d for polls and the
message board will need its own `realtime.messages` policies when those tables
land.

**Storage is a third.** Covered under `assets` — `storage.objects` needs policies
that mirror this schema's, keyed on the org id in the object path.

### Where the policies carry performance risk

1. **`screen_heartbeats` is the sharpest edge.** Millions of rows, and any query
   without `screen_id` in the predicate scans them under a per-row function call.
   Mitigated three ways: 7-day retention, the composite `(screen_id, created_at)`
   index, and the denormalized `last_seen_*` columns on `screens` that keep the
   dashboard off this table entirely.
2. **`board_widgets` at editor load.** Tens of thousands of rows per org, and the
   editor reads a board's worth on every open. The `(board_id, z_index)` index
   keeps the row count small before the policy runs; the risk is a future
   org-wide query ("every widget bound to album X") that scans. That query should
   go through the gin index on `config` with `org_id` leading the predicate.
3. **The `org_members` lookup runs on every single query in the app.** Both
   helpers hit it. If `(user_id, org_id)` is missing or not covering, every RLS
   check in the product does a heap fetch. This one index is worth more than any
   other tuning in the schema.
4. **`stable` versus `volatile` on the helpers.** Marking them `volatile` — the
   default if nobody says otherwise — forces per-row evaluation everywhere and
   silently multiplies the cost of every list query in the app. There is no error
   message for this; it just gets slow.
5. **Soft delete plus RLS.** Policies filter by org, not by `deleted_at`, so every
   application query must remember `where deleted_at is null`. One that forgets
   shows deleted rows to users. Folding `deleted_at is null` into the select
   policy fixes it, but then nothing can ever read a deleted row to restore it.
   Open question 12.
6. **`zmanim_cache`'s select policy is the cheap one and should stay that way.**
   The 90-day bundle read is a PK range scan; adding an ownership join to it, as
   §8 discusses, would put a correlated subquery on the hottest read path in the
   product.

---

## Open questions

Ordered roughly by how expensive they are to get wrong.

**1. CLAUDE.md's "every table has `org_id`" rule contradicts `zmanim_cache`.**
The instruction for this schema is explicit that the cache is shared and has no
`org_id`, and that's the right call — per-org zmanim rows would multiply
MyZmanim's per-location billing by the customer count in each neighborhood. But
the rule as written in CLAUDE.md is unconditional, and the next person to read it
will "fix" the cache. Reword it to "every tenant table has `org_id` and an RLS
policy; shared reference tables have RLS with no write policy" before the first
migration lands.

**2. `board_widgets` as rows versus a single jsonb document on `boards`.** Rows
are specified and rows are what I've proposed, but the editor autosaves on a 1s
debounce with a 50-deep undo stack, and every save becomes a diff-and-upsert
across N rows in a transaction. A single `doc jsonb` column would make each save
one write, make undo trivially a document swap, and make optimistic concurrency a
single version check. What rows buy is queryability — "which boards use this
album", "which widgets use the Chabad provider" for the divergence warning — and
per-widget realtime later. A hybrid is possible: `boards.doc jsonb` as the source
of truth, with a trigger projecting a thin `board_widget_index` table for those
queries. I'd want a decision before P1, because it's the most expensive thing here
to change afterward.

**3. Screen tokens are stored in plaintext.** They have to be displayable — the
gabbai copies the URL onto a TV — so a one-way hash doesn't work without also
keeping the plaintext somewhere. The consequence is that a database read gets an
attacker every screen URL in the product, and those URLs need no auth. Partial
mitigations: keep the token out of any view exposed to `viewer`, log every token
use as plan §8 requires, and rate-limit the bundle route. There's also no rotation
grace period in this schema — rotating a token blacks out the TV until someone
walks over and retypes the URL. A `screen_tokens` child table with `revoked_at`
would allow overlapping validity. Worth doing if screens are ever rotated in
practice.

**4. Tables the plan requires that this pass doesn't cover.** Each needs the same
`org_id` + RLS treatment:
   - `org_invites` — plan §8 specifies pending-invite rows by email. Nothing here
     implements the invite flow.
   - `audit_log` — plan §8, "cheap to add now, valuable when a shul asks."
   - `calendar_events` — the bundle needs 30 days of resolved events offline, and
     `calendar_connections` only stores the connection. Without this table the
     bundle builder calls Google inline, which contradicts §3a.
   - `polls`, `poll_votes`, `message_board_posts` — P7, and the message board
     needs a moderation queue from day one.
   - `subscriptions` / billing — P8, and see question 5.
   - A token-use log for the rate limiting plan §8 asks for.

**5. Per-screen or per-org pricing is still open (plan §10.5) and it shapes this
schema.** I've put a nullable `screen_limit` on `orgs` as a placeholder. If
pricing is per-screen, screens need their own billing state — active, suspended,
trialing — and a suspended screen must degrade to a "contact the shul office"
board rather than going black, which is a display-behavior question as much as a
schema one. Per-org keeps it as one column.

**6. Asset URLs versus offline screens.** Signed Supabase Storage URLs expire; a
screen may be offline for days and is expected to keep rendering from its cached
bundle (plan §3b–3c). A bundle full of URLs that expired on Tuesday shows a board
full of broken images on Thursday — the exact failure the offline design exists to
prevent. Options: a public bucket with unguessable paths (simple, but a shul's
photos of children become publicly fetchable by anyone with the URL), signed URLs
with a TTL longer than the maximum tolerable offline window, or a token-scoped
media proxy route. This needs deciding before P5 and it's a privacy decision, not
just a technical one.

**7. Nothing in this schema stores the resolved bundle.** `bundle_version` is an
integer on `screens` and the plan describes the bundle as computed by the route.
Two gaps: nobody bumps `bundle_version` today — editing an announcement has to
invalidate every screen whose playlist contains a board whose widgets read
announcements, which is a real traversal — and ETag support (§3a) wants a stable
hash of the last built bundle. A `screen_bundles(screen_id, version, etag,
built_at, payload)` table would give cheap 304s, a last-known-good on the server
as well as in IndexedDB, and a place to hang the invalidation. Alternatively an
org-level content counter that any content write bumps, trading precision for
simplicity.

**8. Hebrew dates: structured triple versus stored occurrences.** I've stored
month as text with an explicit `adar_i` / `adar_ii` because numeric months are
ambiguous across leap years, and I've deliberately *not* materialized anniversary
occurrences. If bundle build time makes computing 60 days of yahrzeits per screen
too slow, a `person_occurrences(person_id, occurs_on, kind)` table generated 20
years out via the Hebcal anniversary API is the fix — with the caveat that it must
be regenerated whenever a date is corrected, and a stale occurrence row is a
yahrzeit announced on the wrong day, which is the single worst bug this product
can have.

**9. `schedules` is flat; it may want to be two tables.** One row per item is
simple and matches how the Davening Hours widget reads. But shuls think in named
schedules — "summer weekday", "Shabbos" — and a `schedules` container plus
`schedule_items` would let a whole seasonal set be swapped by changing one
`effective_from`, rather than editing twenty rows. The flat model also can't
express "these five items belong together and are ordered as a unit" except
through `kind` plus `position`. I'd revisit at P4 when real davening data exists.

**10. The canonical zman IDs have no home in the database.** They appear as
`schedules.zman_id`, as keys inside `zmanim_cache.times`, and inside
`board_widgets.config`. Three uncoordinated string vocabularies is how
`tzeis_3_stars` becomes `tzeis_3stars` in one of them. Either a `zman_ids` lookup
table with FKs from `schedules`, or accept that the TypeScript union type in the
widget layer is the source of truth and add no constraint at all. Half-enforcing
it is the worst option.

**11. Fractional `numeric` ordering has a known failure mode.** Repeatedly
inserting between two adjacent items halves the gap each time and eventually
exhausts precision. In practice a playlist has under twenty items and this never
happens, but the alternative — integer positions with a full renumber on each
reorder — is a bigger write for the same result, and lexorank strings are more
machinery than this needs. Flagging it so the choice is deliberate.

**12. Soft delete is inconsistent by design and that's a risk.** Four tables have
`deleted_at`; ten don't. Every query against those four must remember the filter,
and RLS won't remind anyone. Folding `deleted_at is null` into the select policy
makes forgetting impossible but also makes restore impossible without the service
role. My inclination is to fold it into the policy and do restores through a
server route, but it's a real trade.

**13. `has_org_role(uuid, text)` ranks rather than matching exactly.** The plan
fixes the signature but not the semantics. Ranking means `has_org_role(org,
'editor')` is true for admins and owners, which is what every policy in this
document assumes. If the intended reading was exact match, every policy above
needs rewriting to enumerate roles, and adding a fifth role later becomes a
database-wide edit. Worth confirming explicitly, because the two readings are
indistinguishable at the call site and produce silently different access.

**14. Nothing prevents privilege escalation within `org_members` yet.** As
written, an `admin` can update their own row to `owner`, and an `admin` can demote
the last `owner`. Both need trigger enforcement — only owners may grant `owner`,
nobody may change their own role, and an org must always retain at least one
owner. These are constraints RLS cannot express, and they're easy to leave for
"later" and never write.

**15. There's no notion of an active org.** A user may belong to several, every
policy is org-scoped, and the app has to carry an org id in every query. That's
fine and normal, but it means org switching lives entirely in application state
and a bug there shows one shul's data under another shul's name. A
`user_preferences(user_id, last_org_id)` table would at least make the default
deterministic across devices.

**16. Shared infrastructure with the yeshiva system (plan §10.6) is unresolved and
this schema assumes "separate".** `orgs`, `org_members`, and both helper functions
are exactly the layer that would be shared. If the answer is "shared", they belong
in a common schema with the product tables referencing across, and that's very
hard to retrofit once both products have their own `orgs` table with different
columns. This is the cheapest question on the list to answer now and one of the
most expensive to answer late.

**17. Heartbeat data is a movement log of a physical building.** Sixty-second
`ip` and `user_agent` records for a device in a shul lobby, retained
indefinitely, is more than operations needs. The 7-day retention above is my
proposal, not a requirement from the plan. If anyone wants longer uptime history,
roll up to hourly aggregates and drop the raw rows rather than extending the
retention window.
