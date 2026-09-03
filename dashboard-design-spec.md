# Dashboard Design Spec

Companion to `shul-board-plan.md`. This is the visual brief — hand it to Claude
Code *before* any UI work, alongside the token file it tells you to build.

---

## 1. What this product actually is

Not a generic SaaS dashboard. It's a **control desk for physical rooms**.

- **Who's using it:** a gabbai, shul secretary, or rebbetzin. Often 50+, on a
  desktop, not technical, using this maybe twice a week.
- **What they need in three seconds:** is every screen in the building alive, and
  is it showing the right thing.
- **What they need in thirty seconds:** change an announcement, swap a photo,
  fix a davening time before Mincha.
- **What they fear:** the lobby screen is black and forty people are walking past
  it.

That last line is the design brief. This is closer to a broadcast monitoring tool
than to a marketing site. Confidence and legibility over charm.

### Where the visual vocabulary comes from

Two objects already in the building:

1. **The printed luach** — dense ruled tables, bilingual columns, numerals as the
   hero, hierarchy from rule weight and type size rather than boxes.
2. **The yahrzeit memorial board** — dark ground, small lights, a row per name,
   quiet institutional dignity.

Both are **table-first, not card-first.** That single decision is what keeps this
from looking generated, because the dominant AI-design failure mode is chopping
everything into identical rounded cards.

---

## 2. Deliberately avoided

State these as prohibitions in the prompt, because they're the defaults a model
falls into when asked for "warm" or "distinctive":

| Avoided | Why |
|---|---|
| Cream (#F4F1EA) + serif display + terracotta (#D97757) | Currently the single most recognizable AI-generated aesthetic. "Warm and intentional" lands here by default. |
| Indigo / violet / purple gradient accents | The other most recognizable one. |
| Near-black tints (#0B0B0B, #111) used as "black" | Tell. Use a real hue instead. |
| Full broadsheet: zero radius + hairlines everywhere + newspaper columns | Also now a cluster. We borrow the luach's *density*, not its whole costume. |
| Identical rounded cards with matching soft shadows | The SaaS card kit. |
| ALL-CAPS tracked eyebrow labels above headings | Template chrome. |
| Meta strings joined with middle dots (`A · B · C`) | Template chrome. |
| Monospace for small data labels | Template chrome. Use tabular numerals instead. |
| `→` appended to button text | Template chrome. |
| Numbered markers (01 / 02 / 03) | Only legitimate if the content is genuinely a sequence. |
| Icon in a colored rounded square as a section header | Slop signature. |
| `rounded-2xl` on everything | One radius for all hierarchy levels is a non-choice. |

---

## 3. Tokens

Build these as CSS custom properties **first**, in a single file, before any
component. Then forbid raw hex anywhere else in the codebase.

### Color

```css
--ink:        #1B2A2E;  /* deep blue-green. Primary text, editor chrome. */
--ink-soft:   #5A6B6E;  /* secondary text, metadata */
--ink-faint:  #8A9799;  /* placeholders, disabled */
--paper:      #F2F4F3;  /* app background — cool, faintly green-gray */
--surface:    #FFFFFF;  /* content panes, table bodies */
--rule:       rgba(27, 42, 46, 0.10);  /* hairlines */
--rule-firm:  rgba(27, 42, 46, 0.18);  /* section dividers, table header rule */

--verdigris:      #1E6B63;  /* the one accent. Primary actions, active nav, links. */
--verdigris-wash: #E4EEEC;  /* selected rows, active nav background */

--live:    #2E7D5B;
--stale:   #A8721C;
--offline: #A63A2E;
```

Why verdigris: it's oxidized brass — the color those memorial plaques become.
Institutional, specific to the subject, and nowhere near indigo or terracotta.

**Rules:**
- One accent. `--verdigris` marks the primary action in a view and nothing else.
  A view with three verdigris buttons has no primary action.
- Status colors are **only** for status. Never decorative.
- Backgrounds are `--paper` (app) and `--surface` (content). Two surfaces, not
  five. Depth comes from hairlines, not shadows.
- **Shadows exist only on things that genuinely float**: menus, popovers, modals,
  the drag ghost in the editor. Nothing in normal document flow gets a shadow.

### Type

**One family for the whole interface: `Assistant`** (Ben Nathan, free, Google
Fonts). It's a genuinely bilingual Hebrew-and-Latin family with consistent
proportions across both scripts — which matters enormously in a product where
every screen mixes English UI with Hebrew content. Using one family for both is a
choice grounded in the subject, not a default.

**`Frank Ruhl Libre`** is reserved for **Hebrew dates and zmanim values only** —
in board previews and the zmanim settings table. It carries sefarim typography,
which is where those numbers live in real life. It never appears in UI chrome.

Do not use Inter. It is the default and it reads as one.

```
Scale (all Assistant unless noted)
  Page title        20px / 600 / -0.01em
  Section heading   16px / 600
  Body              15px / 400
  Table cell        14px / 400
  Metadata, labels  13px / 400 / --ink-soft
  Smallest          12px  ← floor, never below

Weights: 400 and 600 only. No 500, no 700.
Numerals: font-variant-numeric: tabular-nums on EVERY time, date, and count.
          Non-tabular times in a table jitter and look amateur.
Case: sentence case everywhere. No Title Case, no ALL CAPS.
```

### Space and shape

```
Base unit: 4px. All spacing is a multiple.
Radius:    5px on controls and inputs. 6px on panels. That's it — two values.
           Not 12px, not 16px, not full-round anything except status dots.
Borders:   1px --rule. Never 0.5px (renders inconsistently across displays).
Table row: 40px. Dense but clickable for a 60-year-old with a trackpad.
Controls:  32px high inputs and buttons.
Focus:     2px --verdigris outline, 2px offset. Visible. Never removed.
```

---

## 4. Layout

### Shell

```
┌──────────────┬──────────────────────────────────────────────────┐
│ Beis Menachem│  Screens                          [ Add screen ] │
│ ▾            ├──────────────────────────────────────────────────┤
│              │                                                  │
│  Screens   3 │   content pane, --surface, 6px radius,           │
│  Boards    7 │   1px --rule, sits on --paper                    │
│  Media       │                                                  │
│  People      │                                                  │
│  Notices   2 │                                                  │
│  Schedules   │                                                  │
│              │                                                  │
│  Settings    │                                                  │
└──────────────┴──────────────────────────────────────────────────┘
  216px fixed                    fluid, max 1440px
```

Left rail on `--paper`, no border between rail and content — the surface change
does that work. Active nav item gets `--verdigris-wash` background and
`--verdigris` text, no left-border accent bar.

Counts sit right-aligned in the rail at 13px `--ink-soft`. They're information
(two notices need attention), not decoration.

Copy note: "Notices," not "Announcements." Shorter, and it's what people say.

### Screens view — this is where you spend your boldness

Everything else in the app is quiet. This one view is the product's identity: a
live wall of what every screen in the building is showing right now.

```
┌────────────────────────────────────────────────────────────────┐
│  Screen              Showing            Last seen   Size       │  ← 13px, --ink-soft, 1px --rule-firm below
├────────────────────────────────────────────────────────────────┤
│ ┌──────┐  Main lobby         Weekday board    ● now    1080p   │
│ │ live │  Entrance, north wall                                  │  ← 40px rows
│ └──────┘                                                        │
│ ┌──────┐  Beis medrash       Zmanim + notices  ● now    1080p   │
│ │ live │  Front, above aron                                     │
│ └──────┘                                                        │
│ ┌──────┐  Simcha hall        Shabbos board     ○ 3 days  4K     │  ← --stale
│ │ prev │  East wall                                             │
│ └──────┘                                                        │
└────────────────────────────────────────────────────────────────┘
```

The 64×36px thumbnail is a **real render of that board** at small scale, using
the same widget renderer from §2 of the plan. Not a placeholder icon, not a
gradient. Seeing the actual board is what makes this feel like a control room
rather than a list of database rows.

Status is a 6px dot plus plain-language time. "3 days" not "72h ago," and never a
badge pill.

Row click opens the screen detail. Hover reveals a quiet overflow menu at the
right — no row-lift, no scale transform, no shadow on hover. Background shifts to
`--verdigris-wash` at 40% and that's the whole hover state.

### Editor

Dark chrome, light canvas. This is the one place the pattern is correct rather
than borrowed: the board being designed should be the brightest object on screen,
and dark chrome makes the canvas read as the artifact.

```
┌───────────────────────────────────────────────────────────────┐
│ ← Weekday board            67%  ─ ┼ ─         Saved  [Publish]│  ← --ink chrome
├──────┬─────────────────────────────────────────┬──────────────┤
│      │                                         │              │
│ Add  │        ┌───────────────────┐            │  Zmanim      │
│      │        │                   │            │              │
│ Layers│       │   1920 × 1080     │            │  Source      │
│      │        │   --surface       │            │  [MyZmanim ▾]│
│ ▸ Ti │        │                   │            │              │
│ ▸ Zm │        └───────────────────┘            │  Show        │
│ ▸ Im │                                         │  ☑ Alos      │
│      │           --ink at 88%                  │  ☑ Netz      │
│ 200px│                                         │  ☐ Misheyakir│
└──────┴─────────────────────────────────────────┴──────────────┘
                                                    264px
```

Canvas sits on `--ink` at 88% opacity. Snap guides in `--verdigris` at 1px —
functional, not pink-because-Figma-is-pink. Selection outline 1px `--verdigris`
with 7px square handles.

The right panel is the zmanim capability matrix from §5c made visible:
unavailable zmanim for the chosen source are shown disabled with a tooltip
explaining why, not hidden. Hiding them makes users think the app is broken.

---

## 5. Component rules

- **No card unless the thing is a bounded object.** A contact record, a receipt, a
  single board's settings — card. A list of screens, a settings form, a page of
  content — not a card. This one rule removes most slop.
- **Tables are tables.** `<table>`, hairline under the header row only, no zebra
  striping, no borders between columns, no rounded corners on rows.
- **Buttons:** primary is `--verdigris` fill with white text. Secondary is
  transparent with a 1px `--rule-firm` border. Tertiary is text-only in
  `--verdigris`. One primary per view. No icons inside text buttons unless the
  icon is load-bearing.
- **Empty states are instructions, not moods.** No large centered icon, no
  "Nothing here yet." A heading that names the space, one sentence explaining it,
  one button. "Add your first screen. Each screen gets its own link you open on
  the TV or display device. [Add screen]"
- **Errors say what happened and what to do.** No "Error:" prefix, no apology, no
  first person. "Beis medrash screen hasn't checked in since Monday. Check the
  device is powered on and connected."
- **Motion answers actions only.** Panels slide when opened, rows fade when
  deleted, the save indicator changes state. No entrance animations on page load,
  no hover transitions on every element, no staggered reveals. Respect
  `prefers-reduced-motion`.

---

## 6. Copy

Voice: plain, direct, active. Sentence case. Contractions fine.

| Write | Not |
|---|---|
| Add screen | Create New Screen + |
| Publish | Submit |
| Notices | Announcements Management |
| Hasn't checked in since Monday | Offline (72h) |
| Each screen gets its own link | Screens are provisioned via unique tokens |
| Saved | Successfully saved! |

An action keeps its name through the whole flow: the button says Publish, the
confirmation says Published.

Use the words shuls use — gabbai, zmanim, davening, shiur, kiddush, notices.
Don't translate them into product-speak. This is a product for a specific
community and sounding like you know it is most of the brand.

---

## 7. Prompting Claude Code with this

Order matters:

1. **Session one: tokens only.** Hand it §3. Ask for a single
   `tokens.css` (or Tailwind theme extension) plus a rendered swatch page showing
   every color, the full type scale, and the two radii. Review it, commit it,
   then never allow raw hex again.
2. **Session two: three primitives.** Button, table, and the left rail. These
   three establish the density and set the pattern everything else copies.
3. **Session three onward: views**, one at a time, referencing the wireframes.
4. **Paste §2 (the avoided list) into every session.** It will drift back toward
   cards and cream if you don't. Drift is the default; repetition is the fix.
5. **Ask for a screenshot after each view** and critique against §2 specifically.
   "Does this look generated?" is too vague to act on. "Are there identical
   rounded cards where a table belongs?" is actionable.
