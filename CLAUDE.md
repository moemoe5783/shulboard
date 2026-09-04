# Shulboard

Multi-tenant digital bulletin board SaaS for shuls. Next.js App Router on
Vercel, Supabase (Postgres + Auth + Storage + Realtime).

Full architecture: @docs/plan.md
Visual spec: @docs/design.md

## Structure

- `app/(app)/` — authenticated dashboard. Supabase Auth + RLS.
- `app/s/[token]/` — public display route. No auth. One TV per URL.
- `app/api/screen/[token]/bundle/` — server route, service-role key, returns the
  display bundle. The ONLY place the service-role key is used.
- `widgets/<name>/` — one folder per widget: manifest.ts, Renderer.tsx,
  Settings.tsx
- `lib/tokens.css` — every color, size, and radius in the product

## Hard rules

- The widget Renderer is shared by the editor and the display route. Never fork
  it. If it renders differently in the two places, that's a bug.
- No raw hex, rgb, or Tailwind color classes anywhere outside `lib/tokens.css`.
  Use the CSS variables.
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
  Numbers inside prose stay in Assistant.

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
