# Element Sizing and Content Behavior

Addendum to `dashboard-design-spec.md` and `shul-board-plan.md` §4. Governs how a
board element's box relates to what's inside it.

This is a spec for the **board renderer and editor canvas** — not dashboard
chrome. Per design.md §1b, board content is user-authored data and the chrome
rules don't apply to it.

---

## 1. The problem

Today every element is a fixed box you resize, and content sits inside however it
lands. Three symptoms:

- A two-word title can sit in a box ten times its size, or overflow a box too
  small for it. The box and the content have no relationship.
- Content whose length changes over time — a clock at 12:00 vs 1:00, a parsha
  name, a notice replaced with a longer one — shifts position on screen as it
  changes.
- A centered element with variable content moves at both edges, so it visibly
  jitters. Centered is what most people will choose.

These are two distinct problems: **how the box and content relate at design
time**, and **where content goes when it changes at run time**.

---

## 2. Sizing model

Each element declares a **sizing mode** in its manifest. Two modes, plus a
user-facing toggle where both make sense.

### `fit` — box drives content

The box is authoritative. Content scales to fill it. Resizing the box changes the
rendered type size.

This matches the mental model of someone designing a board: *"this title should
fill this area."* Nobody designing signage thinks in points — they think in "big
enough to read from the back."

Implementation: the renderer measures its container and computes a font size that
fills it, subject to a min and max. Not `font-size: Npx` from config.

Applies to: Title, Announcement, Daily Wisdom, Countdown label, Parsha, any
element whose job is to be as legible as its space allows.

### `fixed` — content drives box

The declared type size is authoritative. The box is a boundary and an alignment
frame, not a scaling factor. Resizing changes the wrap width and the available
area, not the type size.

Applies to: Zmanim tables, Class Schedule, Davening Hours, Message Board — any
element with internal rows that must stay legible and consistent regardless of
how the box is dragged. A zmanim table whose type rescales when you nudge the box
is worse than one that doesn't.

### The toggle

Where both modes are defensible — Clock, Date, Day of Week, Hebrew Date — the
element exposes a **Fit to box / Fixed size** control in the properties panel.
The manifest declares which is the default.

**Clock defaults to `fixed`.** A clock in `fit` mode would rescale its type every
time the digit count changes, which is the worst possible behavior for the single
most-watched element on the board.

### Manifest addition

```ts
sizing: {
  mode: 'fit' | 'fixed'
  userToggleable: boolean
  minFontSize?: number   // design units, for fit mode
  maxFontSize?: number
}
```

### Editor affordance

An element in `fit` mode should make that legible while resizing — the type
visibly scaling as the handle moves is self-explanatory and needs no label. An
element in `fixed` mode should show its wrap boundary while resizing so it's
clear the box is a frame, not a scaler.

### Media: a gap this spec doesn't close

Neither "applies to" list above mentions Image, Video, Gallery, or Collage, and
that's not an oversight to quietly patch — it's a real gap, and this section
says so plainly rather than improvising an answer per widget as each one gets
built.

**Image is a declared no-op, and that's earned rather than an open question.**
It has a `sizing.mode` for manifest completeness — every widget states one —
but there's no font size for a mode to drive: `object-fit: cover`/`contain`
(`imageConfigSchema.fit`, a different, older use of the word "fit") already
makes the image box-driven, which is the entire job `sizing.mode: 'fit'` does
for text. Not toggleable, because there's no meaning for `fixed` to have here.

**Video, Gallery, and Collage each need their own answer, decided before any
of them is built.** They are not Image with extra steps:

- **Video** has an intrinsic aspect ratio and a native duration, neither of
  which a text element has. Does the box crop it (`object-fit: cover`, like
  Image) or letterbox it? Does `fit`/`fixed` mean anything here at all, or is
  this a third category this spec hasn't named?
- **Gallery** rotates through multiple images on a timer, each with its own
  aspect ratio. "The box drives the content" is straightforward per-image, but
  the auto-fill re-roll (plan.md §6) means the content changes on its own
  schedule, independent of anyone touching the box — closer to §3's content-
  growth problem than to §2's sizing problem, and this spec's growth rule
  ("content grows away from its alignment edge") was written for text, not for
  a photo that fills its frame regardless of edge.
- **Collage is the one that actually needs deciding, not just noting.** A
  collage has *internal frames* (plan.md §7: fractional rects within the
  collage bounds, one per photo), and each frame has its own crop, its own
  focal point, its own aspect ratio to satisfy. Resizing the collage's outer
  box doesn't scale a font — it has to either rescale every frame's geometry
  proportionally or re-run the template-matching algorithm against the new
  aspect ratio. **This is not a text-scaling problem wearing a photo's
  clothes, and forcing it through the `fit`/`fixed` vocabulary above would be
  the wrong abstraction** — a collage's box relationship needs its own section
  in this document, written when collages are speced from plan.md §7, not
  improvised three times as Video, Gallery, and Collage each get built and
  each answer this differently.

Until that section exists, a widget folder for any of these three should not
assume `sizing.mode: 'fit'`/`'fixed'` means the same thing it means for text —
treat it as genuinely undecided rather than copying Image's answer, which only
happens to work for Image because cropping already solved its version of the
problem.

---

## 3. Content growth: where the extra space goes

Separate problem, separate mechanism. This applies in **both** sizing modes,
because content changes after the board is designed and nobody is watching.

### The rule

**Content grows away from its alignment edge. The alignment edge never moves.**

| Alignment | Anchored | Grows toward |
|---|---|---|
| Left | Left edge | Right |
| Right | Right edge | Left |
| Center | Center line | Both, symmetrically |
| Top | Top edge | Down |
| Bottom | Bottom edge | Up |

This is what a designer intends when they set alignment: *"this thing lines up
here."* The alignment choice is a promise about which edge is stable, and honoring
it at run time is what makes a board stay composed as its content changes.

Implementation is mostly free — the element's box stays fixed and the content is
positioned inside it by the alignment. The point is that **the renderer must not
resize or reposition the box to fit content**. Only content moves within the box.

### The centered case

Centered content with variable length moves at both edges by design. That is
correct and expected — it stays centered.

But it means a centered clock shifts left and right every hour, and a centered
parsha name jumps weekly. Two mitigations:

1. **Tabular figures are mandatory for numeric content** (see §4). This removes
   the problem entirely for clocks, dates, zmanim, and countdowns — the string
   width stops changing.
2. **For non-numeric variable content**, centered is a legitimate choice and the
   movement is acceptable. Don't engineer around it. A parsha name changing width
   once a week is not a defect.

### Overflow

When content genuinely doesn't fit — a long notice in a `fixed` element, a name
longer than its box:

- **`fit` mode:** scale down to `minFontSize`, then clip with no ellipsis. An
  ellipsis on a lobby screen reads as broken.
- **`fixed` mode:** wrap, then clip at the box boundary.
- **Never** grow the box. A board is a designed composition and elements silently
  resizing would break the layout around them.
- **Editor warning:** flag in the properties panel when content overflows at
  design time. The gabbai should learn this in the editor, not from a screen in
  the lobby.

---

## 4. Tabular figures in the board renderer

**Every element rendering numbers uses tabular figures.** Clock, Date, Hebrew
Date, Zmanim, Countdown, Daf Yomi page numbers, any count.

This is the single highest-value fix for content movement, because it makes the
digit-count problem disappear rather than managing it.

Constraint already established during the tokens work: **Assistant has no tabular
figure set** — `font-variant-numeric: tabular-nums` measurably does nothing on it.
Frank Ruhl Libre does have them.

So: a font offered for numeric board content must have tabular figures, or the
renderer must fall back to one that does for the numeric portion. This becomes a
**selection criterion for the board font library** (plan.md §4d) — when the font
picker is built, each family needs a flag for whether it supports tabular
figures, and numeric elements should either restrict the list or warn.

Verify by measurement, not by applying the property and assuming. Render `11111`
and `00000` in the candidate face and compare widths.

---

## 5. Known bug to fix alongside this

The alignment dropdown in the properties panel renders white text on white —
invisible. Likely a `select` inheriting a dark-chrome token on a light panel, or
inheriting nothing. Check every other `select` and native control in the
properties panel for the same problem.

---

## 6. Naming: "widget" vs "element" — decided

**"Element" in the editor UI. "Widget" everywhere in code.** Settled, not open.

- **In code** — folder names, `WidgetManifest`, `WidgetRenderer`, the registry
  in `widgets/manifests.ts`/`renderers.ts`/`settings.ts`, `dataNeeds`,
  `widgetLabel()`, the `data-widget-id` DOM attribute, `setWidgetConfig`, every
  doc comment — stays "widget". A Zmanim block is a live data component, not a
  static element, and that is still an accurate word for what the folder
  contains. Nothing here changed.
- **In the editor UI** — the add-element menu, the layers panel's empty state,
  the properties panel's headings and multi-selection copy, the status bar's
  count — says "element": "Add element", "Add your first element", "3
  elements selected", "12 elements". A gabbai never reads the word "widget"
  anywhere in the product.

**Why the split holds rather than drifting into an inconsistency someone
"fixes" later:** the two words are answering different questions for
different readers. Code answers "what kind of thing is this to build" for
whoever is adding widget number twenty-six, and "widget" is the more precise
answer — plan.md §5's whole registry pattern (manifest / Renderer / Settings,
one folder each) is written around that word and around `dataNeeds`, which is
a code concept with no UI translation at all. The editor UI answers "what is
this thing on my board" for a gabbai who has never heard either word walk in
the door, and "element" reads as the generic, design-tool-shaped answer —
"widget" in that context sounds like a gadget, not a heading or a clock.
Renaming the UI strings cost four files. Renaming the code would touch every
widget folder, the registry, the bundle builder, and every doc comment that
explains why the registry looks the way it does — for no reader-facing
benefit, since nobody using the product ever sees a folder name. That
asymmetry is why the split is stable rather than a compromise waiting to be
resolved one way: there is no version of "fixing" it that isn't strictly
worse for one of the two readers.

If a future session finds a "widget" in editor UI copy, that is a bug in that
string, not a reason to reopen this. If a future session is tempted to rename
`WidgetManifest` to `ElementManifest` for consistency with the UI word, don't
— read this section first.

---

## 7. Known deviations from this spec — decided, not bugs

Two places the implementation doesn't follow this document to the letter.
Both are deliberate. Recorded here so neither gets "fixed" by a session that
hasn't read the reasoning, and so a review doesn't re-flag them as gaps.

**Clock stays `white-space: nowrap` in `fixed` mode, not "wrap, then clip"
per §3's general overflow rule.** A wrapped clock — `7:4` on one line, `5 PM`
on the next — reads as broken in a way plain text never does, because
everyone already knows the shape a clock is supposed to have. §3's wrap rule
is right for prose and wrong for a value with a fixed, familiar format; Clock
clips instead of wrapping, and no other numeric-format element (Date, Zmanim)
should wrap either, for the same reason.

**A `fit`-mode element has no fitted size at its very first paint under SSR.**
`useFitFontSize` measures the real DOM to compute a size, which needs a
browser; the server has nothing to measure, so a board's first server-rendered
frame ships before that measurement can run, and the client corrects it a
frame later once hydrated. This is the same class of gap Clock's own
`second === null` placeholder already lives with — a value that can only be
known client-side, rendered as nothing rather than as a guess, for one frame
— not a new problem `fit` mode introduced so much as a wider surface for one
that already existed.
