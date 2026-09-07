# Environment variables

Every environment variable this product reads, in one place, because all five
are set by hand in a hosting dashboard rather than committed anywhere, and
"what does this one do again" is exactly the question this file exists to
answer three months from now.

Two are public — meant to reach the browser. Three are secrets — server-only,
same handling as a password. Getting that distinction backwards in either
direction is the mistake this table exists to prevent: a secret in a
`NEXT_PUBLIC_*` variable ships in the browser bundle for anyone to read; a
public one held back as if it were secret just breaks sign-in for no reason.

| Variable | Kind | Required by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | the whole app |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | the whole app |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | the display pipeline (bundle, heartbeat, realtime auth, media proxy, cron worker) |
| `SUPABASE_JWT_SECRET` | secret | live board updates over Realtime |
| `CRON_SECRET` | secret | the bundle build worker |

---

## `NEXT_PUBLIC_SUPABASE_URL`

**What it is.** The project's API URL — a bare host, nothing else:
`https://your-project.supabase.co`. Not the address-bar link to the project's
dashboard (`https://supabase.com/dashboard/project/<ref>`), which is the one
people paste by mistake; the app detects and rejects that specific mistake
rather than trying it and failing CORS with no explanation.

**Where it comes from.** Supabase dashboard → Project Settings → API →
Project URL.

**What breaks without it.** Everything. `lib/supabase/env.ts` treats the app
as unconfigured, and the proxy (`lib/supabase/proxy.ts`) **fails closed**:
every authenticated route redirects to `/sign-in` rather than risking an
open dashboard, and `/sign-in` itself explains that Supabase isn't
configured rather than presenting a form that can only fail. This is
deliberate — the alternative failure mode (fall open, let requests through
with no way to authenticate them) is the dangerous direction.

**The one gotcha that costs an afternoon.** `NEXT_PUBLIC_*` variables are
inlined into the **browser** bundle at *build* time. The server sees a change
to this variable the moment it's set; the browser doesn't see it until the
next deployment. Setting it in the hosting dashboard without triggering a new
build leaves sign-in broken while every dashboard setting says configured.
Set it, then redeploy — don't just save and refresh.

---

## `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**What it is.** The anon/public API key. It is meant to be public — every
query it makes goes through Row Level Security, which is the actual security
boundary, not the key's secrecy.

**Where it comes from.** Supabase dashboard → Project Settings → API →
Project API keys → `anon` `public`.

**What breaks without it.** Identical failure mode to
`NEXT_PUBLIC_SUPABASE_URL` above, including the build-vs-runtime redeploy
gotcha — `readSupabaseEnv()` requires both variables together and treats a
missing one the same as a missing other.

---

## `SUPABASE_SERVICE_ROLE_KEY`

**What it is.** The service-role key. It bypasses Row Level Security
entirely, which is why CLAUDE.md restricts it to exactly five files: the
bundle endpoint, the heartbeat endpoint, the realtime-auth endpoint, the
media proxy, and the cron build worker — every one of them a server route
that does its own authorization (a screen token, a shared secret) rather
than leaning on a policy. It never reaches the browser and never appears in
a client component; `lib/supabase/service.ts` imports `server-only` as its
first line specifically so a client component importing it fails the build
instead of shipping the key.

**Where it comes from.** Supabase dashboard → Project Settings → API →
Project API keys → `service_role` `secret`. Treat it exactly like a
database password — anyone holding it reads and writes every table in every
org, unconditionally.

**What breaks without it.** The entire display pipeline goes dark, silently
from a gabbai's point of view: `serviceClientOrNull()` returns `null`
everywhere it's called, so —

- `GET /api/screen/[token]/bundle` answers 503 "This screen isn't configured
  yet" — every screen in the building shows the waiting state forever.
- `POST /api/screen/[token]/heartbeat` answers 503 — the screens view can
  never show a device as live, because it never hears from one.
- `POST /api/screen/[token]/realtime-auth` answers 503 — see
  `SUPABASE_JWT_SECRET` below; this alone degrades rather than breaks.
- `GET /m/<id>/<variant>-<hash>.<ext>` answers 404 for every asset — every
  photo on every board is a broken image.
- `POST /api/cron/build-bundles` answers 503 — no bundle is ever built or
  rebuilt, so even a screen that once worked never sees a content change.

None of this throws an error a person sees. It looks like every screen in
the shul quietly stopped working at once, which is the scenario CLAUDE.md's
"never uses the service-role key outside these files" rule exists to make
easy to reason about — the failure is always "this key is missing or wrong,"
never "which of five files leaked it."

---

## `SUPABASE_JWT_SECRET`

**What it is.** The project's JWT signing secret — a different value from
both API keys above. It signs the short-lived (5-minute) token
`POST /api/screen/[token]/realtime-auth` mints so a display can subscribe to
its own `screen:<id>` Realtime channel and no other screen's
(`supabase/migrations/20260908090000_realtime_channel_authorization.sql`).
There is no Supabase Auth session behind that token — this secret is what
lets the app mint one anyway, scoped to exactly one screen, without a user
attached.

**Where it comes from.** Supabase dashboard → Project Settings → API → JWT
Settings → JWT Secret. **Rotating it** (the "Generate new secret" button on
that same page) immediately invalidates every realtime-auth token in flight
and, more importantly, every Supabase Auth session in the dashboard app —
gabbais get signed out. Don't rotate this to solve an unrelated problem.

**What breaks without it.** Degrades rather than breaks, and quietly:
`realtime-auth` answers 503, `lib/display/realtime.ts` gets no token back,
and — deliberately, per its own comment — never subscribes unauthenticated
rather than falling back to an open channel. Every screen keeps working off
the 60-second poll alone (`lib/display/useDisplay.ts`), so a board update
still arrives, just up to a minute slower than with Realtime pushing it
immediately. Nothing alerts anyone to this; the only symptom is boards
feeling a little less snappy than they should.

---

## `CRON_SECRET`

**What it is.** A shared secret between Vercel's cron scheduler and
`POST|GET /api/cron/build-bundles` — the only environment variable here that
doesn't come from Supabase at all. Vercel automatically sends
`Authorization: Bearer <CRON_SECRET>` on every cron invocation of a project
that has an environment variable of exactly this name; the route checks that
header against its own copy of the same value
(`app/api/cron/build-bundles/route.ts`).

**Where it comes from.** Nowhere but you. Generate any random string of at
least 16 characters yourself — a password manager's generator is fine — and
set it as a plain environment variable in the hosting dashboard. Vercel does
not create this value automatically; it only forwards whatever you've set
under this exact name.

**What breaks without it.** The route fails closed: `!secret` is checked
before the header comparison, so an unset `CRON_SECRET` refuses every
request with 401, including Vercel's own legitimate scheduled ones — not a
smaller version of the feature, the whole build worker never runs. No new
screen gets its first bundle, and no content edit — a changed announcement,
a rotated davening time — ever reaches a screen that's already running,
because nothing rebuilds `screen_bundles` for it. This is the single point
where forgetting a variable turns into "the product doesn't do anything,"
so it's worth actually testing after setting it: trigger a run by hand from
Vercel's dashboard (Project → Cron Jobs → the entry for this path → **Run**)
and confirm it returns `{"considered": ..., "built": ...}` rather than a 401.

**How often it actually runs.** `vercel.json` schedules this once a day
(`0 9 * * *`, 9am UTC) rather than the every-few-minutes cadence you'd want
for "a gabbai fixes a davening time before Mincha and it shows up soon."
That's not a design choice, it's a **Vercel Hobby plan limit**: a cron
schedule that fires more than once a day fails the whole deployment on that
plan, which is what happened the first time this shipped with a five-minute
schedule. Two ways out, neither of which touches the route itself, since it
already accepts a call from anyone holding the right bearer token — that's
exactly what makes both of these possible without a code change:

- **Upgrade to Vercel Pro.** Removes the limit entirely; cron can run as
  often as once a minute. Bump the schedule in `vercel.json` back down once
  you're on it.
- **Add a second, external scheduler** that hits
  `POST https://<your-domain>/api/cron/build-bundles` with
  `Authorization: Bearer <CRON_SECRET>` on whatever cadence you want, and
  leave Vercel's own daily cron running as a fallback. Any free scheduler
  that can send one HTTP header works — a scheduled GitHub Actions
  workflow, cron-job.org, EasyCron. Vercel's per-project limit only governs
  jobs configured in *its own* Cron Jobs feature; it has no way to know or
  care who else calls the URL.

Until one of those is in place, treat this as a real limitation, not a
rounding error: a content edit can sit for up to a day before it reaches a
screen.

---

## Setting these up on a real project

Ask Claude Code to run the migrations and wire up the cron job — neither
needs a terminal on your end, only the Supabase and Vercel dashboards. In
short:

1. Both `NEXT_PUBLIC_*` values, from Supabase → Project Settings → API.
2. `SUPABASE_SERVICE_ROLE_KEY`, same page, `service_role` `secret`.
3. `SUPABASE_JWT_SECRET`, same page, JWT Settings tab.
4. `CRON_SECRET` — invent one, set it in Vercel too. `vercel.json` already
   declares the cron entry (`0 9 * * *`, once a day — see the section above
   for why it isn't more often on a Hobby plan, and how to add a faster
   external scheduler without waiting on an upgrade); Vercel reads it from
   the repo automatically on deploy and needs no dashboard configuration of
   its own beyond the environment variable.

All five go in the hosting platform's environment variable settings — for
Vercel, Project → Settings → Environment Variables. `.env.example` only ever
carries the two public ones as fillable lines; it names the three secrets in
a comment explaining why each is deliberately left without one, rather than
inviting anyone to paste a real value into a file that gets committed.
