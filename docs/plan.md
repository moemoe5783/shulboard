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
(for Chabad, their `Get_Zmanim` endpoint — §5c). But
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

> **CURRENT STATE: CHABAD.ORG ONLY, AND NOTHING IS SELECTABLE.** The
> multi-provider decision above is still the design; only one leg of it is
> built and offered. Hebcal and Manual are gone as **zmanim providers** —
> not from the org settings form, not as a per-widget override, and not as
> a fallback. `lib/zmanim/provider.ts` is the single gate:
> `effectiveZmanimProvider()` resolves every stored `zmanim_provider` to
> `'chabad'`, so an org still on the schema's `'hebcal'` default is served
> as Chabad rather than rendering nothing. The DB enum keeps all four
> values and no row is migrated.
>
> **This is not a removal of `@hebcal/core`,** which is untouched and
> load-bearing: it computes Hebrew dates, the parsha and the daf (§3b's
> "computed in the browser, no network needed, ever"), and it still tells
> candle lighting *which* dates are candle-lighting dates. The line is
> **hebcal is the calendar, Chabad is the clock** — a hebcal event reaching
> a board is a label, never a time.
> `lib/zmanim/hebcal-zmanim.ts` is the zmanim computation, kept in the repo
> and unwired.
>
> **And there is no calculated fallback.** A date Chabad has not published
> shows the unavailable state ("No candle lighting time for this date", "No
> zmanim for this date"), not a computed time with a caveat. The "Showing
> calculated times" indicator is gone with the thing it indicated. That
> makes the unavailable state **common rather than rare** — everything past
> the 92-day window, and every date a warm missed — so its wording is
> written to be read by a room as intentional.

**Provider status as of this writing:**

| Source | Access | Cost | Notes |
|---|---|---|---|
| Hebcal | Official REST API + `@hebcal/core` JS lib | Free | Only one that runs client-side. Default. |
| MyZmanim | Official REST/SOAP, `api.myzmanim.com`, User+Key | $15/mo/10 locations, $40/mo/100, then $0.10 each | Requires internal `LocationID`. **Decided: ZIP-level only** — resolve via `searchPostal` at onboarding and cache the LocationID on the org. Street-address and shul-specific lookups are manual through their mobile app; don't build for them, and don't market address-level precision. |
| Chabad.org (locations) | **`Get_Locations?location=<query>`** — a public search resolving a place name to Chabad's own opaque location id. `{"Suggestions":[{"Title":"Lugano,  Switzerland","Value":"872","ItemType":"1"}]}`: `Value` is the `locationid`, `ItemType` is the `locationtype`. Lowercase param, no `aid`. `lib/zmanim/chabad-locations.ts`. | Free | **This is what unblocked non-US shuls** — `locationtype=1` was reachable in code and unusable in practice, because the only way to get an id was to dig one out of a chabad.org URL and there was nothing to verify it against. **Only one query has ever been observed.** Multi-result behaviour, misspellings and places with no Chabad presence are unknown; the reader assumes none of it and `scripts/probe-chabad-locations.ts` is what settles it. **`ItemType` may be `"2"`,** meaning `Value` is a ZIP — never hardcode `1`. Note `Title` has irregular internal whitespace ("Lugano,&nbsp;&nbsp;Switzerland"); normalize for display, never the `Value`. |
| Chabad.org (zmanim) | **`Get_Zmanim`, one request for everything** — `webservices/zmanim/zmanim/Get_Zmanim?locationid=<ZIP>&locationtype=2&save=1&tdate=<M-D-YYYY>&jewish=Zmanim-Halachic-Times.htm&startdate=<M/D/YYYY>&enddate=<M/D/YYYY>&before=18&after=42&ShabbosEnds=1&bdef=0`. **92 days verified**, every day in the span, carrying all thirteen daily zmanim *and* candle lighting on every Erev Shabbos and Yom Tov. Permission for the data granted directly, no attribution asked for; the endpoint itself is undocumented, which is why `ZMANIM_CHABAD_ENABLED` still gates it. `lib/zmanim/chabad-adapter.ts`. | Free | **The trailing four parameters are not optional.** Without `before`/`after`/`ShabbosEnds`/`bdef` the same request returns the full day count and zero candle-lighting times, with nothing anywhere saying why. **The date formats deliberately differ** — `tdate` is M-D-YYYY, `startdate`/`enddate` are M/D/YYYY. Params are case-sensitive and fail SILENTLY: `locationId` is ignored and falls back to Brooklyn, so the `LocationName` check is load-bearing. `ShabbosEnds` is genuinely mixed-case; don't normalize either. |
| Manual | You | — | Per-zman override or fixed offset. `lib/hebrew/candle-times.ts`'s `havdalahShitahSchema` already has a `"custom"` value that is this same idea at the grain of one zman (fixed minutes after sunset) — built for a standalone Havdalah widget that shipped, then got removed in favor of this section. Decide whether it becomes this Manual provider's own Havdalah row or stays separate when this section is built. |

**Canonical zman IDs.** Providers name things differently (`tzeit7083deg` /
`Shkiah` / etc.), so define your own vocabulary and write a thin adapter per
provider that maps into it:

`alos_72`, `alos_16.1deg`, **`alos_baal_hatanya`**, `misheyakir`, `netz`,
`sof_zman_shma_gra`, `sof_zman_shma_mga`, **`sof_zman_shma_baal_hatanya`**,
`sof_zman_tfila_gra`, `sof_zman_tfila_mga`,
**`sof_zman_tfila_baal_hatanya`**, `chatzos`, `mincha_gedola`,
`mincha_ketana`, `plag_hamincha`, `shkia`, **`tzeis_baal_hatanya`**,
`tzeis_3_stars`, `tzeis_medium_stars`, `tzeis_72`, `candle_lighting`,
`shabbos_ends`, `chatzos_laila`

**The four Baal HaTanya ids are named for the shitah the data measures**,
not for the nearest existing id. They were the open item this list carried
until the Zmanim widget needed them, and the reason they are not
`sof_zman_shma_gra` and friends is that 1–2 minutes from the GRA is still a
different shitah: a GRA label on a Baal HaTanya time is a false claim about
what a board is showing, which is worse than a longer vocabulary. See the
measurement below.

The list is **not** a zod enum anywhere. `widgets/zmanim`'s config stores
plain strings, so adding the next four ids is not a schema migration for
every stored board document — an id nothing supplies simply resolves to no
row, the same thing `candle_lighting` does on a Tuesday.

**This vocabulary is invisible plumbing and must stay that way.** A
canonical id exists so a board document survives a provider change: the
same `netz` row reads from Chabad today and from MyZmanim after a settings
change, with nothing in the document edited. What reaches a screen is
always the provider's own label for that id — Chabad sends "Latest
Shacharit", the board shows "Latest Shacharit" — which is why
`zmanim_cache.times` stores a `label` beside every value
(`lib/zmanim/zman.ts`) rather than this project keeping a translation table.
House vocabulary (`ZMAN_PANEL_LABEL`) is editor chrome, and reaches a board
only when there is no provider string to show instead.

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
screen someone is standing in front of. Chabad's half of that matrix is
already written as data, in `lib/zmanim/zman.ts` — deliberately client-safe
(no `server-only`) so a settings panel can read it without a server
round-trip for a static table.

**Settings UI:** pick source → capability-filtered checkbox list → reorder rows
→ per-row custom label (English/Hebrew/transliterated) → per-row time format.

**Hebrew labels — the provider's, and only the provider's.** The Zmanim
widget has a whole-table English/Hebrew switch (not yet per-row), and both
sides are Chabad's own words: it sends "Latest Shacharit" and "סוף זמן
תפילה". **There is deliberately no house Hebrew table**, because putting a
zman under a Hebrew name this project asserted would be making a halachic
claim rather than displaying theirs — a row with no Hebrew from the
provider falls back to its English instead.

**Hebrew only exists in one of the two response shapes**, and which
parameter selects it is unresolved. `Days[].TimeGroups[].Items[]` carries
`HebrewTitle` on every group (plus `OpinionInformation` — "Alter Rebbe
(Default)" — and `TechnicalInformation` — "16.9 degrees below horizon",
"10.2 degrees", "6 degrees", which independently confirm the Baal HaTanya
measurement below from the provider's own mouth). `Days[].Zmanim[]`, which
is what the 92-day request returns, carries none. The two roots are
structurally identical with `IsAdvanced: false` in both, so it is a per-day
difference; the hypotheses are one of the four trailing parameters (`bdef`
by name) or the range length. `lib/zmanim/chabad-adapter.ts` parses BOTH
shapes so Hebrew arrives the moment the nested one does, and
`scripts/probe-chabad-shape.ts` is what settles it. If it turns out to be
the range length, the answer is a second tiny request per warm purely to
harvest names.

**The Hebrew is per-DAY, not per-type**, which is why it is cached on each
value rather than harvested once. `ShabbatEndTime` came back as "הדלקת
נרות" (candle lighting) on the second night of a two-day Yom Tov and "צאת
החג" (the festival ends) the next day — a halachic distinction its own
English title flattens to "Shabbat Ends" on both.

**Hebrew is RTL and the table mirrors.** One `dir="rtl"` on the two-column
grid puts the labels on the right and the times' column on the left, where
a Hebrew reader's eye starts. The times themselves stay LTR in either
script: a clock time is Latin digits in a fixed order, and reversing "7:22
PM" is not something any luach prints.

**Two rules that prevent support tickets:**
1. **Provider is a screen-level setting** ("zmanim profile"), with per-widget
   override. If the zmanim widget uses Chabad and candle lighting uses Hebcal,
   they will disagree by a minute and someone will notice. Warn on divergence.
2. **Never re-round or recompute provider output.** Each source rounds
   deliberately (candle lighting down, latest-shma down, etc.). Display verbatim.
   Offer an optional attribution line on the board ("Zmanim: MyZmanim").

**Chabad-sourced zmanim beyond candle lighting — RESOLVED.** `Get_Zmanim`
supplies all of it, 92 days at a time, in the same request as candle
lighting. The two surfaces this section used to weigh are both retired
for the purpose: the published candle-lighting **embed** covers four
weeks of candle lighting only (kept unwired in
`lib/zmanim/chabad-embed.ts` as a fallback if `Get_Zmanim` ever changes),
and the published zmanim **RSS feed** returns one day per request with no
date parameter and could never fill a cache at all.

**What Chabad.org actually supplies, measured.** Every zman in a real
92-day response was compared against `@hebcal/core`'s own implementations
across all 92 days, and the answer is uniform: **Chabad.org publishes the
Baal HaTanya (Alter Rebbe) shitah.** `alosBaalHatanya` and
`sofZmanTfilaBaalHatanya` match to the minute on every single day;
`sofZmanShmaBaalHatanya`, `minchaGedolaBaalHatanya`,
`minchaKetanaBaalHatanya` and `plagHaminchaBaalHatanya` to within one.
Candle lighting is exactly 18 minutes before sunset (the request's own
`before=18`, echoed back in `LocationDetails`), and `ShabbatEndTime`
tracks 8.5° tzeis rather than the `after=42` the request sends.

`Tzeis` and `ShabbatEndTime` are **mutually exclusive**: the 17 days in a
92-day span that carry `ShabbatEndTime` are exactly the 17 with no
`Tzeis`. Chabad publishes one nightfall per day and relabels it, so a
widget reading `Tzeis` unconditionally is blank every Shabbos.

**FOUR CANONICAL IDS ARE MISSING FROM THE LIST ABOVE, and this is the
one open item this endpoint created.** Because the shitah is Baal
HaTanya, four of Chabad's fifteen types have no honest id here:

| Chabad type | Why no id fits |
|---|---|
| `AlosHashachar` | Not `alos_72` (73–79 min before netz, so it varies with the season) and not `alos_16.1deg` (3–4 min earlier than it). Needs `alos_baal_hatanya`. |
| `LatestShema` | 1–2 min from GRA, 34–35 min later than MGA — close enough to GRA to be tempting and still a third shitah. Needs `sof_zman_shma_baal_hatanya`. |
| `LatestTefillah` | Same. Needs `sof_zman_tfila_baal_hatanya`. |
| `Tzeis` | 6°, earlier than all three of `tzeis_3_stars` / `tzeis_medium_stars` / `tzeis_72`. Needs `tzeis_baal_hatanya`. |

**All four are now named** — see the canonical list above — so those types
map like every other. `ShaahZmanit` is the one still unmapped: a
**duration** ("62:51 min."), and this list has no concept of one. It is
cached under `chabad:ShaahZmanit` rather than dropped, and deliberately
**not offered in the Zmanim widget** — a provider-namespaced key in a board
document defeats the one property canonical ids exist for, it cannot sort
into a time-ordered list, and nobody in a lobby davens by it.
`lib/zmanim/zman.ts` holds the tables and the measurement.

Two mappings that DO hold, and are worth stating because they look like
gaps: `EarliestTefillin` ("Earliest Tallit", measured as misheyakir
machmir at 10.2°) maps to `misheyakir`, and `ChatzosNight` maps to
`chatzos_laila` — the latter with the one quirk in the whole cache, that
its instant falls on the day AFTER the row it is filed under, because it
is the midpoint of the following night. That is proven rather than
assumed, off the Nov 1 DST fall-back: chatzos halayla differs by under a
minute between two adjacent nights normally, but across a fall-back the
two candidate readings are an hour apart, and the response matches the
following-night one.

**International shuls, and how a city id is verified.** A shul with no US
ZIP picks its city from `Get_Locations` in org settings, and **three things
are stored, not one**: `orgs.zmanim_location_id` (the `Value`),
`orgs.zmanim_location_type` (the `ItemType`) and
`orgs.zmanim_location_name` (the Title). The type is stored because a search
may return `ItemType` `"2"` for a US result, where the `Value` is a ZIP —
assuming `"1"` for anything found by name would silently query a different
place, so it is never defaulted and a third value is rejected rather than
coerced.

The **name is what makes a city id safe**, and it closes the gap that made
`locationtype=1` unusable rather than merely unsupported. A ZIP verifies
against the zmanim response's own `LocationName`, which contains it; a city
id had nothing to check — `LocationId` comes back null, and "Brooklyn, NY"
is a perfectly normal-looking answer to a request that was meant to be
Lugano. Now the searched Title is compared against that `LocationName` and
a mismatch **refuses the whole response rather than caching it**
(`verifyLocationName`). The comparison is on the city token before the first
comma, case- and whitespace-insensitively, because no `LocationName` from a
`locationtype=1` request has been observed and requiring the two surfaces to
format a region identically would refuse every international shul on the
first formatting difference. An id stored before the search existed has no
name, cannot be verified, and is logged loudly rather than refused —
blanking a board to enforce a check it predates would be the fix breaking
what it protects.

**ZIP stays the path for US shuls.** `resolveChabadLocation` is ZIP-first,
needs no lookup, and the geocoder already derives the ZIP from the address
lookup. The city search is the no-US-ZIP case and the settings form says so
where it sits, rather than offering two location fields as equals — which is
the mistake the removed hand-typed field made. A searched `ItemType` `"2"`
result caches under `zip:<id>`, the same key a shul that typed that ZIP
produces, so the two share one cached row.

**Caching.** Postgres table keyed `(provider, location_id, date)`. Twenty Crown
Heights shuls share the same rows, so one API call serves all of them. This is
what keeps MyZmanim's per-location billing manageable and limits blast radius if
Chabad's endpoint breaks. Warm 90 days ahead on a cron; bundle reads
from cache only, never calls a provider inline.

**Chabad is no longer an exception to the 90 days.** `Get_Zmanim` returns
the whole span in one request, so `lib/zmanim/warm.ts` warms **92 days**
(inclusive of today, two days of slack over the figure above so a daily
cron can never leave a same-day gap). Note the difference in kind from
the embed's four weeks: four **was** a measured cap, silently coerced from
any larger value. 92 is simply the largest span anyone has verified — what
happens at 183 or 365 days is unknown, so the warmer reports the
response's own `EndDate` alongside the range it asked for rather than
assuming they agree. `scripts/probe-chabad.ts` is what would settle it.

**Fallback chain — DESIGN, NOT CURRENT STATE:** requested provider → cache
→ Hebcal (client-side, always works) → last known good, with a subtle
"showing calculated times" indicator rather than a silent failure.

**Only the first two legs are built.** There is no Hebcal leg and no
indicator: a date Chabad has not published shows the unavailable state (see
the note at the top of this section). The chain above is what to restore
when a second provider returns, and it is worth keeping written down
because the reasoning for the indicator — "a wrong zman is worse than a
flagged one" — is still right the moment there is anything to flag.

**`lib/zmanim/hebcal-zmanim.ts` is that Hebcal leg, kept unwired.** It is
Baal HaTanya throughout: four of the ids it computes name that shitah
outright, so a gabbai would select it by selecting the row, and the
shitah-neutral ones (`netz`, `shkia`, `chatzos`, `mincha_gedola`,
`mincha_ketana`, `plag_hamincha`, `misheyakir`, `chatzos_laila`) use
`@hebcal/core`'s Baal HaTanya variant where one exists — a table mixing
Baal HaTanya's alos with the GRA's plag is a table no luach prints, and the
difference is not cosmetic (plag 3–4 minutes apart, misheyakir 6–8 at 10.2°
against `@hebcal/core`'s own 11° default). It is kept rather than deleted
because it is measurably correct against real provider data: every value
sits **within one minute** of Chabad's on all 92 days of the fixture, per
shitah, including across the DST fall-back. Re-offering Hebcal is a
decision about what a board may show, not a piece of work.

`candle_lighting` and `shabbos_ends` are deliberately **not** in it. Both
are date-conditional events rather than times every day has, and working
out which dates they fall on is what `lib/hebrew/candle-times.ts` and the
Candle Lighting widget already do — a second copy is the fork this project
refuses everywhere else.

**One nightfall, relabelled — the substitution a Zmanim widget must make.**
Because `Tzeis` and `ShabbatEndTime` are mutually exclusive in the source, a
widget configured for `tzeis_baal_hatanya` would go blank on all 17
Shabbos/Yom Tov days in a 92-day window — which is exactly when the most
people are reading the board. `lib/zmanim/zman.ts`'s `ZMAN_SUBSTITUTE` maps
`tzeis_baal_hatanya` ← `shabbos_ends` and the row then carries the
**substitute's own label** ("Shabbat Ends"), which is the whole disclosure.
It is one-directional on purpose: a 6° nightfall is 24–26 minutes after
sunset and a Shabbos end 34–38, so substituting toward the stricter time is
safe and away from it would tell a room Shabbos is over ten minutes early.

**Open items:** MyZmanim attribution/ToS requirements for commercial resale;
how far past 92 days `Get_Zmanim` will actually go; and a canonical id for
`ShaahZmanit` if a board ever wants that row. ~~Chabad.org permission for
programmatic access~~, ~~Chabad-sourced zmanim beyond candle lighting~~ and
~~naming the four Baal HaTanya canonical IDs~~ — **all resolved, §10.4 and
above.** The Hayom Yom / Chitas licensing question is the one that still
wants a Chabad.org conversation.

**Still missing from the capability matrix, and visible in the UI as
such:** nothing supplies `alos_72`, `alos_16.1deg`, the GRA or MGA shma and
tfila deadlines, `tzeis_3_stars`, `tzeis_medium_stars` or `tzeis_72`. The
Zmanim widget's panel shows those rows **disabled with a reason** rather
than hiding them, per this section's own rule and design.md §4 ("hiding
them makes users think the app is broken") — and the reason is the
interesting part: they are absent because Chabad publishes Baal HaTanya,
not because nobody got round to them. `tzeis_medium_stars` and `tzeis_72`
are the closest to reachable — `lib/hebrew/candle-times.ts`'s
`havdalahOffsetFor()` already maps them, as this section notes above.

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
4. ~~**Chabad.org terms**~~ — **decided.** ~~And non-US shuls are no longer
   blocked~~: `Get_Locations` (§5c) resolves a city name to a location id,
   which is what `locationtype=1` was always missing. Permission for the data was
   granted directly by Chabad.org, and **no attribution was asked for** —
   the credit link in their embed markup was an inference from the markup,
   not a stated term, and the widget does not render one. Don't re-add it
   assuming it is a licence condition; `widgets/candle-lighting/Renderer
   .tsx` carries a comment at the removal site saying so.

   **The reader is `Get_Zmanim`** (`lib/zmanim/chabad-adapter.ts`), which
   supplies all thirteen daily zmanim and candle lighting together, 92 days
   per request — see §5c for the measured detail. The published
   candle-lighting embed (`/tools/shared/candlelighting/candlelighting.js
   .asp`, `lib/zmanim/chabad-embed.ts`) is kept unwired as a fallback: it
   is four weeks of candle lighting only, so a strict subset, but it is
   Chabad's own public embed and `Get_Zmanim` is not documented anywhere.
   That last point is why `ZMANIM_CHABAD_ENABLED` still gates the whole
   provider.

   **Still open:** MyZmanim's own resale terms, and Hayom Yom / Chitas text
   licensing.
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
