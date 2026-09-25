# Shulboard

Multi-tenant digital bulletin board SaaS for shuls. Next.js App Router on
Vercel, Supabase (Postgres + Auth + Storage + Realtime).

Full architecture: @docs/plan.md
Visual spec: @docs/design.md
Environment variables: @docs/environment.md

## Structure

- `app/(app)/` — authenticated dashboard. Supabase Auth + RLS.
- `app/s/[token]/` — public display route. No auth. One TV per URL.
- `app/api/screen/[token]/bundle/`, `.../heartbeat/`, `.../realtime-auth/`,
  `app/m/[id]/[file]/`, `app/api/cron/build-bundles/`,
  `app/api/cron/warm-zmanim/`, `app/api/cron/clean-media/`,
  `app/api/pair/start/`, `app/api/pair/poll/`, `publishBoard` in
  `app/(editor)/boards/[id]/actions.ts`, `assignBoard` in
  `app/(app)/screens/actions.ts`, and `lib/zmanim/warm.ts` — the
  twelve places holding the service-role key. `clean-media` is the nightly
  media cleanup (lib/storage/retention.ts): it sweeps every shul's trash and
  the whole Storage bucket, the same cross-tenant read-and-delete no policy
  expresses; the hard delete itself is `lib/storage/purge.ts`, which Media's
  "Delete permanently" also calls under the editor's own session, so that
  button holds no key. `assignBoard` earns it exactly
  as `publishBoard` does: it calls the same `buildScreenBundle`, for the one
  screen whose board was just chosen, so the TV switches in seconds rather
  than at the next cron sweep; the screen id is a row it read under the
  admin's own session. The two `pair` routes are TV
  pairing (supabase/migrations/20260925090200_screen_pairing.sql): a TV at
  `/pair` has no session, and `pairing_requests` deliberately has no
  policies, so asking for a code and checking whether it was entered can only
  be done with the key. Each answers only about the caller's own device
  secret. The admin's half — entering the code — is `claim_pairing`, a
  SECURITY DEFINER function under the admin's own session, not a key holder;
  so are invitations (`accept_org_invite`, `invite_preview`,
  `org_member_directory`). **One TV per screen** is enforced in
  `lib/screen-token.ts`, which every screen route calls: a screen bound to a
  TV answers only that TV's secret. `publishBoard` is a Server
  Action, not a route, and it earns the exception by calling the exact same `buildScreenBundle` the cron
  route does, immediately, for the screens the just-published board reaches,
  rather than a second copy of the build logic. `warm-zmanim` is the Chabad
  cache-warming cron (plan.md §5c) — once daily, not the 5-minute cadence
  `build-bundles` runs at, because zmanim don't change from one hour to the
  next. It reads **two published sources** and merges them into
  `zmanim_cache`: the **RSS feed** (`lib/zmanim/chabad-rss.ts`) for the daily
  zmanim table — **US-only, today only**, but it carries the transliterated
  Hebrew names the widget needs — and the **candle-lighting embed**
  (`lib/zmanim/chabad-embed.ts`) for candle lighting and Shabbos ends, **four
  weeks** per run (chabad.org caps it at 4). Because the RSS half is one day,
  the daily run is load-bearing for coverage: a day the cron doesn't run is a
  day with no zmanim table once every screen's bundle rolls past it; the embed
  half slides a four-week candle-lighting window forward so that widget's
  "upcoming" view keeps working. The embed leg is best-effort — if it fails,
  today's zmanim still cache and the outcome flags `embedFailed`. The 92-day
  `Get_Zmanim` reader (`lib/zmanim/chabad-adapter.ts`) is kept **unwired** —
  like `hebcal-zmanim.ts` — for the day the whole span has to come from one
  request again. `warm-zmanim`
  earns the key for a reason separate from the warming itself: it sweeps
  every org and screen to discover which locations are referenced at all,
  a cross-tenant read no RLS policy can express.
  `lib/zmanim/warm.ts` is a lib module rather than a route, and it is what
  actually writes `zmanim_cache`. Two things warm that cache — the cron
  above and the "Use this address" action in org settings (which geocodes,
  saves the location, and warms in one step) — so the write lives
  here once rather than as two copies that can drift. It needs the key
  because `zmanim_cache` has exactly one RLS policy, a SELECT, and
  deliberately no write policy at all: the table is shared across every
  org, so a write policy for tenant admins would let one shul's admin
  poison rows twenty neighbouring shuls read. The settings action that
  calls it holds no key of its own.
  **It also queues the bundle rebuilds, and that is not incidental.** The
  cache is read at BUILD time and frozen into `screen_bundles`
  (plan.md §3a), so writing it changes nothing any screen shows until that
  screen's bundle is rebuilt. Every other content table gets that for free
  from the `request_org_rebuild()` triggers; `zmanim_cache` cannot, because
  that function keys on `org_id` and this table deliberately has none. So
  the invalidation is application code here, and the count of screens
  queued is reported back through the cron's JSON and the settings
  action — a warm that queues nothing on a location a shul really uses is
  the signature of a board that will keep saying "No zmanim for this date".
  Nowhere else uses the service-role key.
- `widgets/<name>/` — one folder per widget: manifest.ts, Renderer.tsx,
  Settings.tsx
- `lib/zmanim/chabad-locations.ts` — Chabad's public `Get_Locations`
  search, which is what makes a **non-US shul** configurable: it resolves a
  city name to Chabad's own location id AND its type AND a Title. All three
  are stored (`orgs.zmanim_location_id` / `_type` / `_name`) — never
  hardcode the type, and the Title is what the zmanim response's own
  `LocationName` is verified against, which is what stops a wrong id
  caching another country's times. ZIP stays the path for US shuls;
  `resolveChabadLocation` is ZIP-first. **Only one query has ever been
  observed** — the reader assumes nothing about multi-result behaviour and
  `scripts/probe-chabad-locations.ts` is what settles it.
- `lib/zmanim/provider.ts` — **Chabad.org is the only zmanim source.**
  `effectiveZmanimProvider()` resolves every stored `zmanim_provider` to
  `'chabad'`, so an org still on the schema's `'hebcal'` default is served
  as Chabad rather than rendering nothing; the DB enum keeps all four
  values and nothing migrates. There is no calculated fallback either — a
  date Chabad hasn't published shows the unavailable state, not a computed
  time. **This is not a removal of `@hebcal/core`,** which still powers
  Hebrew Date, Parsha and Daf Yomi and still tells candle lighting which
  dates are candle-lighting dates: hebcal is the calendar, Chabad is the
  clock. `lib/zmanim/hebcal-zmanim.ts` is the zmanim computation, kept
  unwired.
- `lib/tokens.css` — every color, size, and radius in the product

## Hard rules

- The widget Renderer is shared by the editor and the display route. Never fork
  it. If it renders differently in the two places, that's a bug.
- A widget Renderer takes `{config, canvas}` and nothing else. A proposal to add
  a `surface`, `mode`, or `isEditor` prop is the fork arriving in disguise —
  refuse it and solve the problem another way.
- No raw hex, rgb, or Tailwind color classes anywhere outside `lib/tokens.css`.
  Use the CSS variables. **This governs the application interface, not board
  content** — see the scope rule below.
- Every tenant table has `org_id` and an RLS policy, written in the same
  migration as the table. `zmanim_cache` is deliberately shared across orgs and
  has no `org_id` — this is correct, do not "fix" it.
- The service-role key is used only in server-only code. It never appears in a
  client component, in `app/s/`, or in any file that doesn't import
  `server-only`.
- Positions in board documents are stored as percentages, never pixels.
- Any column of clock times in dashboard chrome is set in Frank Ruhl Libre,
  which has tabular figures. Assistant has none, so `tabular-nums` is a no-op on
  it — apply the numeric utility anyway (it costs nothing and starts working if
  the face changes), but never rely on it to align a column set in Assistant.
  Numbers inside prose stay in Assistant. **The same holds on a board, measured
  there and not inherited:** `scripts/test-font-parity.mjs` reads `11111`
  against `00000` inside the real board and finds the sefarim face closes a
  6.97px spread to 0.00px under `tabular-nums` while the UI face is 3.08px
  either way. A column of board times gets its clean edge from setting the face.
  On a board that face is `NUMERIC_FONT` (lib/board-theme.ts): the chosen font,
  in its own lining figures (`lining-nums tabular-nums`, `widgets/Digits.tsx`).
  Digits are boxed to the face's widest digit (measured per weight at build
  time, `--board-digit-<weight>`) only where they tick in place — a clock
  showing seconds; the zmanim grid and a once-a-minute clock don't need it. A
  face whose figures are old-style with no lining set (Marcellus, Pinyon
  Script, Parisienne, Suez One, and Alef for boards that already use it) sets
  the WHOLE time in its matched fallback — Frank Ruhl Libre for a serif, Heebo
  otherwise — at a weight tuned to match (`numericFace`, `numericWeight`,
  `TIME_FALLBACK_WEIGHT`, tuned in /fonts-lab). Script faces aren't offered in
  time widgets' pickers.
  **The face is necessary and not sufficient.** Figures of equal width still
  do not line up when the strings are different lengths: `7:22 PM` against
  `11:21 AM` puts the two-digit hour a digit out past the one-digit ones,
  whatever the metrics. So a column of times is laid out on the time's
  internal structure — the hour, the `:MM` and the meridiem each get a grid
  track shared by every row, with the hours right-aligned inside theirs
  (`widgets/zmanim/Renderer.tsx`, `widgets/zmanim/display-time.ts`). Splitting
  the string is display, never reformatting: the pieces rejoin to the
  provider's exact characters, asserted against every value in the 92-day
  fixture. `scripts/test-zmanim-layout.mjs` measures the resulting edges in a
  real browser.

## Scope: chrome versus board content

The design spec governs dashboard chrome. **A board is a user-authored artifact
and its content is data, not UI.** A board document may use any color, radius or
font the user chooses — including verdigris, and radii outside the two-value
scale. Image assets may contain any color.

The chrome rules below — two radii, one accent, weights 400 and 600, no raw hex
outside `lib/tokens.css` — apply to the application interface and to the
renderer's own chrome (its empty states, its unknown-widget notice). They never
apply to what a shul puts on its board. Do not flag a board document, a board
theme, or an image asset for breaking them.

## Visual rules — these get violated constantly, check every time

- Tables for lists. Cards ONLY for a single bounded object.
- One primary (verdigris) action per view. Everything else is secondary.
- Shadows only on things that float: menus, popovers, modals, drag ghosts. Never
  on in-flow content.
- Two radii only: 5px controls, 6px panels.
- Font weights 400 and 600 only.
- Sentence case everywhere. Never Title Case, never ALL CAPS.
- Banned: cream backgrounds, serif display type, terracotta/indigo/violet
  accents, all-caps eyebrow labels, `A · B · C` middot meta strings, monospace
  for data labels, `→` in button text, `01/02/03` markers, icons in colored
  rounded squares, identical rounded cards in a grid.

## Copy

Sentence case, active verbs, contractions fine. "Add screen" not "Create New
Screen". "Saved" not "Successfully saved!". No "please", no "simply", no
exclamation marks. Use the community's words: gabbai, zmanim, davening, shiur,
notices.

## Workflow

- Run `npm run typecheck` and `npm run lint` before saying a task is done.
- Small commits, one concern each.
- Never run `supabase db reset` against a remote project.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
