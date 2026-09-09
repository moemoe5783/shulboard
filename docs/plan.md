# Shul Bulletin Board SaaS — Build Plan

Stack: Next.js (App Router) on Vercel, Supabase (Postgres + Auth + Storage + Realtime), Stripe later.

---

## 1. Core object model

```
Org
 ├── Members (owner / admin / editor / viewer)
 ├── Screens          → each has its own unguessable display URL
 ├── Boards           → a canvas design (the thing you edit)
 ├── Playlists        → ordered/scheduled set of boards
 ├── Assets           → images/videos in Supabase Storage
 ├── Albums           → collections of assets (auto-fill source for widgets)
 ├── People           → birthdays + yahrzeits live here
 ├── Announcements
 ├── Schedules        → davening times, shiurim
 └── Calendar links   → Google Calendar connections
```

**Key decision: a Screen points at a Playlist, not a Board.** Even if 90% of shuls
only ever want one board, modeling it as a playlist from day one gives you free
rotation, dayparting ("weekday board 6am–6pm, Shabbos board Friday 2pm–Saturday
9pm"), and event takeovers. Retrofitting this later is painful.

Screen URL: `board.app/s/<32-char token>` — no login, no cookie, works on any
smart-TV browser or Chromecast. Token is rotatable/revocable per screen. Add a
short pairing code (`ABC-123`) as an alternative entry method, since typing a
32-char URL on a TV remote is miserable. Pairing code redirects to the token URL
once, then the device keeps it.

---

## 2. The two halves of the app

These have almost opposite requirements, so keep them cleanly separated:

| | Editor (`/app/*`) | Display (`/s/[token]`) |
|---|---|---|
| Auth | Supabase Auth + RLS | none, token-only |
| Users | 1–10 per org | 1 device, runs for months |
| Priority | ergonomics, undo, precision | never blank, never stale, never leak memory |
| Data | live queries | one signed "bundle" + realtime patches |

**The one thing they share: the widget renderer.** Same React component tree
renders in both. The editor just wraps each widget in a selection/transform
frame. If you ever fork these, WYSIWYG dies. Enforce it in the folder layout.

---

## 3. Display resilience (the offline requirement)

This is the part that decides whether shuls trust the product. Design:

### 3a. The bundle
Server route `GET /api/screen/[token]/bundle` returns a single JSON doc:
board definitions, widget configs, resolved data (announcements, calendar events
for the next 30 days, birthday/yahrzeit list for the next 60 days, schedules),
asset URLs, theme tokens, `bundle_version` integer, `ttl`.

Runs on the server with the service role key — never expose the anon key to the
display client and never try to do this with RLS gymnastics. Add ETag so
unchanged polls are 304s.

**The endpoint must reject a revoked or rotated token, and that is where token
rotation actually takes effect.** The display route is storage-first: it boots
from the token it has kept since it was paired, because that is what makes the
pairing code work and what lets an unplugged screen come back on its own.
Client storage therefore cannot enforce rotation — a device that has booted once
will keep presenting its old token no matter what URL somebody opens on it. The
server is the only place that can say no. So a 401 or 410 here is not an error
path bolted on later; it is the compensating control that makes "rotate this
screen's link" mean anything, and the display's response to it is to clear its
stored token and fall back to whatever the URL carries.

### 3b. Compute locally, prefetch the rest
Clock, date, Hebrew date, parsha, daf yomi, countdowns — **computed in the
browser** from lat/long + system clock. No network needed, ever.

Zmanim are the exception, because of the multi-provider decision (see §5c): when
the source is Chabad.org or MyZmanim, the values come from a remote source
(for Chabad, their published candle-lighting embed — §5c). But
zmanim are deterministic and known in advance, so the bundle ships **90 days of
resolved zmanim** for the screen's location and provider. Offline behavior is
identical; the screen just needs to reconnect sometime within three months.

Only human-entered content (announcements, events, photos) can go stale, and the
30–60 day lookahead means even that keeps rotating.

### 3c. Storage layers
- **IndexedDB** — last-known-good bundle. On boot, render from it *immediately*,
  then fetch fresh in the background.
- **Cache Storage (service worker)** — all images/videos, cache-first.
- **Atomic swap** — never apply bundle v(n+1) until every asset it references is
  cached. Prevents "new board, missing photos." Prefetch assets for the *next*
  board in the playlist too.

### 3d. Live updates without refresh
- Supabase Realtime broadcast on channel `screen:<id>`. `buildScreenBundle`
  publishes `bundle_changed` after a build that actually bumps `version` →
  display refetches and cross-fades. Not on every autosave — a board's draft
  doesn't touch a screen at all until it's published (docs/schema.md §5's
  `published_doc`) — so this fires from a publish's own immediate build, or
  from the cron sweep picking up a queued content change.
- **The channel is private and authorized per screen, not open to the anon
  key.** The anon key is public and identical for every screen the product
  serves, so subscribing also requires a short-lived JWT from
  `POST /api/screen/[token]/realtime-auth` (re-validates the display token,
  never a Supabase Auth session) carrying that one screen's id as a claim. An
  RLS policy on `realtime.messages` lets a client onto `screen:<id>` only if
  its JWT names that id. Skipping this is not a smaller version of the
  feature — it is any anonymous client able to subscribe to (or, absent a
  matching insert policy, still not publish on) any screen's channel.
- **Plus a 60s polling fallback.** TV browsers drop websockets constantly and
  don't always fire reconnect events. Belt and suspenders.
- Widget-level realtime for polls and message board (direct Postgres changes
  subscription, no bundle round-trip).

### 3e. Long-running hygiene
- Heartbeat POST every 60s → dashboard shows "Sanctuary Lobby — last seen 40s
  ago." Shuls will call you about black screens; you need this.
- Scheduled self-reload at ~3:00am local (memory leaks in TV WebViews are real).
- Global error boundary → log + reload rather than white screen.
- No `setInterval` accumulation: one master rAF/second-tick that all time widgets
  subscribe to.

### 3f. The build worker's throughput — a known limit, not a bug

`GET|POST /api/cron/build-bundles` processes at most `BATCH = 10` screens per
invocation, oldest-queued first, so one org with a slow rebuild can't blow the
route's wall-clock budget and starve everyone behind it. An external
scheduler calls this route every 5 minutes (docs/environment.md's
`CRON_SECRET` section — there is deliberately no Vercel cron entry for it),
which drains the queue at 10 screens / 5 min = 2 screens/min = **120
screens an hour.**

That's fine for the org sizes this product has today and a real ceiling once
it isn't: **200 screens queued at once — one org publishing to all of them,
or an org-wide content edit invalidating everyone simultaneously — take
over an hour to fully drain** (200 / 120 ≈ 1.7 hours), even though any one
screen's own build takes seconds. Nothing alerts anyone to this; a screen at
the back of that queue just looks slow to update, with no error anywhere.

Worth revisiting once queue depth is a real, observed problem — raising
`BATCH`, running invocations concurrently, or per-screen rate limiting
instead of one global queue — but not before then. Deciding this now would be
guessing at a scale the product hasn't reached.

---

## 4. The design board

The main event. Build it DOM-based, not canvas-based.

Reason: your widgets are live HTML — `<video>`, iframes, ticking clocks,
real-time poll results. Fabric.js / Konva / tldraw all assume drawable shapes and
would force you into iframe-in-canvas hacks. Absolutely-positioned divs with CSS
transforms give you Canva-grade interaction *and* live content.

### 4a. Coordinate system
- Fixed design canvas, e.g. 1920×1080 (also offer 1080×1920 portrait, 3840×2160).
- **Store positions as percentages, render as pixels.** A board then scales to
  any actual screen resolution. Font sizes in `cqw`/`vw`-relative units or a
  single root scale factor.
- Editor shows the canvas zoom-to-fit with a zoom control; you always *edit* in
  design units so numbers stay meaningful.

### 4b. Interaction spec (write this down, it's the acceptance criteria)
- Drag; **Alt+drag** duplicates
- 8 resize handles + rotate handle; **Shift** constrains aspect ratio
- **Shift+drag** constrains to one axis
- Snapping: to canvas center/edges, to other widgets' edges and centers, to a
  configurable grid. Pink alignment guides appear during drag.
- **Ctrl/Cmd held = snapping off** (your "ctrl to stop clicking")
- Arrow keys nudge 1px, Shift+arrow 10px
- Marquee selection + Shift-click multi-select; group/ungroup
- Align + distribute toolbar for multi-selection
- Z-order: bring forward/back/front/back, plus a layers panel
- Lock, hide, duplicate, delete
- Undo/redo as a command stack (~50 deep) — implement from the start, not later
- Copy/paste within and across boards. **Across boards needs the async Clipboard
  API and its permission prompt** — the board fragment is written as JSON to the
  system clipboard and read back on paste, so it survives a reload and a second
  tab. A module-scope variable is a dev-lab shortcut that only holds within one
  page session; it is not the implementation.
- Right-click context menu mirroring the above

### 4c. Foundation — DECIDED
**`react-moveable` + `react-selecto`** (same author, designed to pair). They give
you drag/resize/rotate/snap-guides/multi-select on arbitrary DOM out of the box
and are what most Canva-alikes are actually built on.

Keep them behind your own `<TransformFrame>` wrapper rather than sprinkling
`<Moveable>` through the editor. Two reasons: the snapping/modifier behavior in
§4b needs tuning in one place, and if you ever outgrow the library the swap is
contained to one component.

Known rough edges to budget for: rotation + nested-scroll coordinate math,
snap-guide performance with 30+ elements on the canvas (throttle guide
recalculation, and only compute guides against elements in the viewport), and
touch behavior if you ever want tablet editing.

State: Zustand store holding the board doc + a separate undo stack. Autosave
debounced 1s, with an explicit save indicator.

### 4d. Theming
Org-level design tokens (palette, 2–3 font pairings, spacing scale, border
radius). Widgets inherit by default, override per instance. This is what makes a
shul's boards look coherent instead of like a ransom note.

**The dashboard's own visual direction is specified separately in
`dashboard-design-spec.md`** — tokens, type, layout wireframes, and the
anti-generic prohibitions. Read that before building any UI.

Visual direction: dense, high-contrast, typographically confident — these are
read from 20 feet away in a lit lobby. No translucent panels, no gradient cards,
no soft oversized radii; those tank legibility at distance and look generic.
Think transit-signage clarity with warm, intentional type.

---

## 5. Widget system

Registry pattern. One folder per widget:

```
/widgets/zmanim/
  manifest.ts     id, name, description, category, icon?, defaultSize, isPro,
                  settingsSchema (zod), instanceLabel?, dataNeeds
  Renderer.tsx    shared by editor + display, takes {config, canvas}
  Settings.tsx    the right-hand panel
```

`dataNeeds` is the important bit: the bundle builder reads every widget's
declared needs, dedupes them, and fetches once. Two calendar widgets pointing at
the same Google Calendar = one API call.

**A need is structured and carries its parameters.** `{ kind: 'calendar',
calendarId }`, not `'calendar'` — because the whole behaviour above turns on
telling two calendars apart, and two widgets reading different calendars declare
the identical string. `kind` is a free string, so a new kind of need is a new
widget folder rather than an edit to a shared union; parameters are scalars, so
a need has an identity that can be compared. Dedupe on the whole need with keys
sorted, since two widgets may declare the same need in a different order.

**`dataNeeds` is a function of the instance's config, not a constant.** Which
calendar, which album, which asset all live in the config; a manifest-level list
cannot see them. The builder walks every widget on every board, calls
`dataNeeds(widget.config)`, and dedupes what comes back. A widget that needs
nothing returns `[]` — still a function, so there is one shape to read.

**The Renderer takes `{config, canvas}` and nothing else.** No `surface`, no
`mode`, no `isEditor`. That prop is the editor/display fork arriving in
disguise, and §2 is the reason: the editor wraps the renderer in a transform
frame and suppresses pointer events on its contents, and everything that
legitimately differs between the two halves is done in that wrapper. See
CLAUDE.md.

Adding widget #26 should mean creating one folder and nothing else. The registry
collects `*/manifest.ts` and `*/Renderer.tsx` by resolving the folder at build
time rather than reading a hand-kept list, so a widget that exists but was left
out of an array — it works, it is simply absent from the add menu — cannot
happen. Manifests are collected separately from renderers and hold no React, so
the bundle builder can read `dataNeeds` on the server without pulling a
component tree into a server route.

### Widget list, grouped by data dependency

**Pure client-side (work fully offline, no backend):**
Clock, Date, Day of Week, Zmanim, Candle Lighting + countdown, Parsha, Daf Yomi,
Countdown Timer, Title, QR Code

**Org content (from bundle, 30–60 day lookahead):**
Announcements, Davening Hours, Class Schedule, Birthdays, Yahrzeits, Daily Wisdom

**Media (bundle + cached assets):**
Image, Video, Gallery, Collage

**Needs network at display time (degrade gracefully):**
Weather, YouTube, Website iframe, Poll, Message Board

That last group needs explicit offline states — a stale-weather badge, a poll
that shows last-known counts. Decide the fallback per widget in the manifest.

### Libraries
- **`@hebcal/core`** — Hebrew dates, parsha, holidays, Daf Yomi, omer. Mature,
  well-maintained, runs client-side. This is your always-available baseline.
- **Hebcal Yahrzeit + Anniversary API** — generates yahrzeit, Yizkor, Hebrew
  birthday and anniversary dates 20 years out. Use it for the People/Yahrzeit
  widgets rather than writing the Hebrew anniversary logic yourself; the leap-year
  Adar and Cheshvan/Kislev edge cases are where hand-rolled versions break.
- Google Calendar API (read-only, incremental sync tokens).

### 5c. Zmanim provider layer

**Decision: support Hebcal, Chabad.org, and MyZmanim as selectable sources, plus
manual override.** The shul picks a source, then picks which zmanim from that
source appear. Rationale: shuls want the board to match the printed luach on
their wall, and these three genuinely differ by a minute or two.

**Provider status as of this writing:**

| Source | Access | Cost | Notes |
|---|---|---|---|
| Hebcal | Official REST API + `@hebcal/core` JS lib | Free | Only one that runs client-side. Default. |
| MyZmanim | Official REST/SOAP, `api.myzmanim.com`, User+Key | $15/mo/10 locations, $40/mo/100, then $0.10 each | Requires internal `LocationID`. **Decided: ZIP-level only** — resolve via `searchPostal` at onboarding and cache the LocationID on the org. Street-address and shul-specific lookups are manual through their mobile app; don't build for them, and don't market address-level precision. |
| Chabad.org | **Candle lighting: the published embed**, `candlelighting.js.asp?locationid=<ZIP>&locationtype=2&ln=2&weeks=<n>` — the surface Chabad.org pointed at when asked (§10.4). Sanctioned, server-side, attribution required. **Zmanim beyond candle lighting: still unresolved** — see below. | Free | Params are case-sensitive and fail SILENTLY: `locationId` is ignored and falls back to Brooklyn. `weeks` is coverage, not rows — `weeks=4` returns 13 entries over 24 days. |
| Manual | You | — | Per-zman override or fixed offset. `lib/hebrew/candle-times.ts`'s `havdalahShitahSchema` already has a `"custom"` value that is this same idea at the grain of one zman (fixed minutes after sunset) — built for a standalone Havdalah widget that shipped, then got removed in favor of this section. Decide whether it becomes this Manual provider's own Havdalah row or stays separate when this section is built. |

**Canonical zman IDs.** Providers name things differently (`tzeit7083deg` /
`Shkiah` / etc.), so define your own vocabulary and write a thin adapter per
provider that maps into it:

`alos_72`, `alos_16.1deg`, `misheyakir`, `netz`, `sof_zman_shma_gra`,
`sof_zman_shma_mga`, `sof_zman_tfila_gra`, `sof_zman_tfila_mga`, `chatzos`,
`mincha_gedola`, `mincha_ketana`, `plag_hamincha`, `shkia`, `tzeis_3_stars`,
`tzeis_medium_stars`, `tzeis_72`, `candle_lighting`, `shabbos_ends`,
`chatzos_laila`

`tzeis_medium_stars` (7.0833°, "3 medium stars") is not aspirational like the
rest of this list — it's real code today, just not wired to any widget.
`lib/hebrew/candle-times.ts` has `havdalahShitahSchema`,
`havdalahCustomMinutesSchema`, and `havdalahOffsetFor()`, mapping
`tzeis_3_stars` / `tzeis_medium_stars` / `tzeis_72` / a custom-minutes value
to the `{havdalahDeg}` / `{havdalahMins}` shape `HebrewCalendar.calendar()`
expects. That's the Hebcal provider's tzeis adapter this section needs,
already written — it was built for a standalone Havdalah widget that shipped
and was then removed once Havdalah's place turned out to be here instead of
its own widget. **The Zmanim build should call this rather than re-deriving
it.**

**Capability matrix.** Each provider declares which canonical IDs it supplies.
The settings UI greys out unavailable ones — never render a blank row on a
screen someone is standing in front of.

**Settings UI:** pick source → capability-filtered checkbox list → reorder rows
→ per-row custom label (English/Hebrew/transliterated) → per-row time format.

**Two rules that prevent support tickets:**
1. **Provider is a screen-level setting** ("zmanim profile"), with per-widget
   override. If the zmanim widget uses Chabad and candle lighting uses Hebcal,
   they will disagree by a minute and someone will notice. Warn on divergence.
2. **Never re-round or recompute provider output.** Each source rounds
   deliberately (candle lighting down, latest-shma down, etc.). Display verbatim.
   Offer an optional attribution line on the board ("Zmanim: MyZmanim").

**Chabad-sourced zmanim beyond candle lighting is still open.** §10.4's
conversation resolved candle lighting and only candle lighting: Chabad.org
pointed at their published candle-lighting embed, which carries exactly
what it says — candle lighting and Shabbos/Yom Tov end times, nothing
else. There is no sanctioned bulk source for alos, netz, the shma and
tfila deadlines, shkia or tzeis: **the published zmanim RSS feed returns
one day only and takes no date parameter, so it cannot fill a 90-day
cache.** The undocumented `Get_Zmanim` JSON endpoint does carry all
thirteen, which is why `lib/zmanim/chabad-adapter.ts` is kept unwired
rather than deleted — but wiring it back is a permission question, not a
refactor, and it needs its own conversation. Until then a shul choosing
Chabad.org gets Chabad's candle lighting and Hebcal's everything else.

**Caching.** Postgres table keyed `(provider, location_id, date)`. Twenty Crown
Heights shuls share the same rows, so one API call serves all of them. This is
what keeps MyZmanim's per-location billing manageable and limits blast radius if
Chabad's unofficial endpoint breaks. Warm 90 days ahead on a cron; bundle reads
from cache only, never calls a provider inline.

**Fallback chain:** requested provider → cache → Hebcal (client-side, always
works) → last known good. Surface a subtle "showing calculated times" indicator
rather than failing silently, since a wrong zman is worse than a flagged one.

**Open items:** MyZmanim attribution/ToS requirements for commercial resale;
Chabad-sourced zmanim beyond candle lighting (see above). ~~Chabad.org
permission for programmatic access~~ — **resolved for candle lighting,
§10.4.** The Hayom Yom / Chitas licensing question is still worth bundling
into the next Chabad.org conversation, alongside the zmanim one — same
organization, one ask.

### Hebrew/format options (per screen, override per widget)
- Hebrew script vs transliterated: `כ״ג אלול` / `23 Elul` / `23 Elul 5786`
- Gematria numerals vs Latin; year with or without `ה׳`
- Nekudos on/off
- Sunset rollover toggle (does the Hebrew date flip at sunset or midnight)
- 12/24h, seconds on/off, timezone per screen
- Nusach (Ashkenaz / Sefard / Ari / Edot Hamizrach) — drives davening labels and
  some zmanim defaults
- RTL text direction per text widget; ship a real Hebrew font stack

**Note on Hayom Yom and Chitas:** the schedule is calculable, but the *text* is
copyrighted (Kehot / Sichos in English). Get permission or link out rather than
reproducing text. Worth resolving before launch since these are exactly the
widgets Chabad shuls will want most.

---

## 6. Photos: the Google constraint and the workaround

**What's no longer possible:** as of March 2025 the `photoslibrary.readonly`,
`photoslibrary.sharing`, and `photoslibrary` scopes are removed. The Library API
only sees media your own app uploaded. Album-level continuous sync of a user's
existing Google Photos album is dead for third parties. Picker API requires a
human to manually select items in a session, so it can't run unattended.

**Decision for v1: Albums with manual upload only.** No Drive sync, no Picker
import, no email-to-album. Those become later additions.

**The one thing to get right now: keep `source` on the album table** even though
`'manual'` is the only value in v1. Add the enum
(`manual | drive | photos_import | email`) and a nullable `source_config` jsonb
from the first migration. Widgets bind to albums and never learn where photos
came from, so adding Drive sync later is a worker plus a settings panel — not a
data migration.

**Since upload is the only path, the upload UX *is* the feature:**

- Multi-file drag-and-drop, folder drop, clipboard paste
- **HEIC conversion is mandatory, not optional.** iPhones shoot HEIC by default,
  browsers won't render it, and a gabbai uploading 30 photos from a kiddush will
  hit this on day one. Convert server-side on upload (`libheif`/`sharp` in a
  Supabase Edge Function or a Vercel function) and store JPEG/WebP derivatives.
  Silent failure here looks like "the app is broken."
- Honor EXIF orientation, then **strip EXIF on the derivatives** — GPS coordinates
  on a shul's photos shouldn't be served publicly.
- Generate variants on upload: thumb (400px), display (1080px), large (2160px),
  WebP + AVIF. Screens fetch by slot size, not the original.
  **Serving side already exists and fixes the shape:** `GET
  /m/<asset_id>/<variant>-<hash>.<ext>` reads a variant out of
  `assets.variants` (jsonb keyed by variant name), where each entry must carry
  `storage_path`, `content_hash`, `extension`, `content_type`, `bytes` — the
  upload pipeline's job is to write exactly that shape, not invent its own.
  The route serves bytes straight from Storage with the service role (never a
  signed URL — §3a's reasoning about expiry applies here too), 404s a hash or
  extension that no longer matches what's on file, and 404s a soft-deleted
  asset (`deleted_at`) rather than serving it. A bundle only ever embeds one
  variant per asset today (`display`) because `dataNeeds` carries an
  `assetId` and nothing yet says which size a widget wants.
- Per-file progress, resumable for large videos, clear per-file error states.
- Reordering, captions, bulk delete, bulk move between albums.

**One cheap addition worth considering in v1: a shareable upload link.** A
tokenized URL per album (`/u/<token>`) that anyone can open on a phone and upload
to without an account. Costs you almost nothing on top of the upload pipeline you
already need, and it captures most of what email-to-album would have given you —
the gabbai texts the link to whoever took photos at the event. Needs a moderation
queue if you turn it on.

Album is the universal primitive either way: widgets (Gallery, Collage, Image)
bind to an album, and auto-fill widgets re-roll their selection on a timer so a
board shows fresh photos for weeks untouched.

---

## 7. Collages

Two-layer design:

**Layer 1 — Templates.** A template is a set of frames, each a fractional rect
`{x, y, w, h}` within the collage bounds, plus gutter and corner radius. Build a
library keyed by photo count (2 through 9), several variants each, mixed
orientations. Maybe 40 templates total.

**Layer 2 — Matching.** Given N photos with known aspect ratios:
- Score every candidate template: for each frame, compare frame aspect to the
  aspect of the photo you'd assign, penalize mismatch (a portrait photo in a wide
  frame crops badly).
- Solve the photo→frame assignment greedily (or Hungarian algorithm if you want
  it optimal — N ≤ 9, so it's cheap).
- Pick the best-scoring template. Offer a "shuffle layout" button that steps
  through the next-best options.

Per-frame controls: `object-fit: cover` + adjustable focal point (drag to
reposition crop), drag-to-swap between frames, per-frame zoom.

**Upgrade path:** generative guillotine layout — recursively split the collage
rect, biasing each split so the resulting cells' aspects match the available
photos. Handles any N and produces novel layouts. Do this only after the template
approach is shipped; it's easy to over-invest here.

**Auto-fill mode:** a collage bound to an album re-rolls its photo selection on a
timer, so the same design shows fresh photos over weeks without anyone touching
it. This is the feature that makes collages actually get used.

---

## 8. Multi-tenancy and auth

- Supabase Auth (email magic link + Google OAuth).
- `org_members(org_id, user_id, role)`. RLS policy on every table keyed on
  `org_id` via a `is_org_member(org_id)` SQL helper. Write the policies alongside
  each migration, not in a cleanup pass.
- Roles: **owner** (billing, delete org), **admin** (screens, members, all
  content), **editor** (boards + content, no member management), **viewer**.
- Invite flow by email with pending-invite rows.
- Display route bypasses RLS entirely by design — it's a server route validating
  a token. Rate-limit it and log token use.
- Audit log table for content changes (who changed the announcement) — cheap to
  add now, valuable when a shul asks.

---

## 9. Build phases

**P0 — Skeleton (1 week)**
Repo, Supabase project, auth, org creation, RLS helpers, empty editor shell,
`/s/[token]` route rendering a hardcoded board. Prove the two-app split works.

**P1 — Editor core (2–3 weeks)** ← *the highest-risk phase, do it early*
Canvas, transform layer, snapping, multi-select, undo/redo, layers, autosave,
3 trivial widgets (Title, Image, Clock). Get it feeling right before adding
breadth. If the editor isn't pleasant, nothing else matters.

**P2 — Widget breadth (2 weeks)**
Registry + manifest system, then all client-side widgets: Date, Day of Week,
Zmanim, Candle Lighting, Parsha, Daf Yomi, Countdown, QR. Hebrew/format options.
Fast going once the registry exists.

**P3 — Display hardening (1–2 weeks)**
Bundle endpoint, IndexedDB last-known-good, service worker asset cache, atomic
swap, realtime + polling, heartbeat, nightly reload. Test by pulling the
ethernet cable and by leaving a screen up for a week.

**P4 — Org content (1–2 weeks)**
Announcements, People (birthdays/yahrzeits, with Hebrew date anniversary logic —
yahrzeits are genuinely fiddly: Adar in leap years, Kislev/Cheshvan variable
lengths, the sunset-of-death question). Davening + class schedules. Google
Calendar connection + Upcoming Events widget.

**P5 — Media (1–1.5 weeks)**
Upload pipeline (HEIC conversion, EXIF handling, variant generation), Albums,
Gallery, Video, optional shareable upload link. Then collages.
*Shrank from 2 weeks — sync integrations deferred.*

**P6 — Playlists & scheduling (1 week)**
Board rotation, dayparting, Shabbos-aware scheduling, event takeover.

**P7 — Interactive (1 week)**
Poll with QR voting + realtime results, Message Board with moderation queue.
(Moderation is not optional — an open submit form on a shul lobby screen will be
abused within a month.)

**P8 — Commercial**
Stripe, plan gating on the `isPro` manifest flag, onboarding, templates gallery
(pre-built boards so a new shul gets a good-looking screen in 5 minutes — this
is your biggest conversion lever), screen-count limits.

---

## 10. Decisions worth making before writing code

1. ~~Editor foundation~~ — **decided:** react-moveable + selecto behind a
   `<TransformFrame>` wrapper. See §4c.
2. ~~Photo sync source of truth~~ — **decided:** albums with manual upload for
   v1, `source` column present from day one for later sync. See §6. Sub-question
   still open: ship the tokenized shareable upload link in v1 or not?
3. ~~Zmanim library~~ — **decided:** multi-provider (Hebcal / Chabad.org /
   MyZmanim / manual), see §5c. Remaining sub-question: does MyZmanim ship in v1
   given it's a paid per-location dependency, or is it a paid-tier feature added
   after launch?
4. ~~**Chabad.org + MyZmanim terms**~~ — **partly decided.** Chabad.org, asked
   directly, pointed at their **published candle-lighting embed**
   (`/tools/shared/candlelighting/candlelighting.js.asp`) rather than at the
   undocumented `Get_Zmanim` JSON endpoint. Candle lighting therefore runs on
   a sanctioned, public surface with an attribution condition — the widget
   shows "Times by Chabad.org" whenever the value on screen is theirs, and
   that credit is not user-removable, because a shul cannot license it away
   on Chabad's behalf. `lib/zmanim/chabad-embed.ts` is that reader.
   **Still open:** Chabad-sourced zmanim beyond candle lighting (§5c — the
   RSS feed is one day at a time and cannot fill a cache), MyZmanim's own
   resale terms, and Hayom Yom / Chitas text licensing.
5. **Screen count pricing** — per-screen or per-org? Shapes the schema.
6. **Shared infra with the yeshiva system?** Both are multi-tenant Supabase apps
   for frum institutions with overlapping customers. Worth deciding now whether
   they share an auth/org layer or stay fully separate products.

---

## 11. Notes for prompting Claude Code

Don't hand it this whole document. It's a reference; feed it in slices:

- **One phase per session**, with the relevant section pasted in full.
- **Lock the schema first.** Session 1 = migrations + RLS only, reviewed by you,
  committed. Everything downstream depends on it and it's the most expensive
  thing to get wrong.
- **The interaction spec in §4b is the prompt for P1** — it's already written as
  acceptance criteria. Ask for it as a standalone demo page with a few colored
  divs before any real widgets exist.
- **Give it the widget manifest interface and one complete example widget**, then
  ask for the rest in batches of 4–5. Consistency will hold.
- Ask for a `CONVENTIONS.md` in the repo after P0 (folder layout, naming, how a
  widget is added, how RLS helpers work) and reference it in every later prompt.
  This is the single highest-leverage thing for keeping a long multi-session
  build coherent.
