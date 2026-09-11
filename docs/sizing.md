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

Each element declares a **sizing mode** in its manifest. Three modes, plus a
user-facing toggle where more than one makes sense.

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

Applies to: Zmanim tables, Class Schedule, Davening Hours — any element whose
row count is a design-time choice (which zmanim are enabled, which classes are
listed) that doesn't change on its own between when the gabbai builds the board
and when a screen shows it. A bounded frame the gabbai deliberately sized is the
right model here, not one that quietly resizes out from under a layout they
composed around it.

### `fit` for the Zmanim table means something else — decided

**The Zmanim widget's `fit` does NOT implement this section's `fit`, and
that is deliberate rather than a deviation to fix.** §2's fit is "the box is
authoritative, content scales to fill it" — a search for the largest size
fitting BOTH axes. That is right for a title and wrong for a table, because
it makes the type size a function of how many rows there happen to be
today.

Its rules instead, in `widgets/zmanim/fit.ts`:

1. **Vertical resize drives the size.** A taller box means bigger text,
   proportionally.
2. **Horizontal resize does not, on its own.** Widening a box that already
   had room changes nothing.
3. **The times are never clipped horizontally.** Too narrow for the time
   column at the height-driven size means smaller type, exactly small
   enough to fit. Labels truncate instead — see below.
4. **Vertical overflow is acceptable.** Grow into available height even
   when the list then no longer fits and has to scroll or page.

So `size = min(boxHeight / (8 rows × per-row height), boxWidth /
time-column width)`, clamped. Rule 2 falls out of the `min`; rule 4 falls
out of the first term not reading the row count. **No binary search** — for
rows that do not wrap, both width and row height scale linearly with font
size, so one measurement at any known size gives exact ratios.

**Rule 2 has a second half, and getting it wrong is what "narrowing the box
makes the font smaller" was.** The width term was originally measured as the
grid's whole `max-content` width — every label at full length — which is the
table's IDEAL width, not its minimum. So the type started shrinking the
moment the box was narrower than ideal, over a band about 2.5× wide on a
realistic row (a sixteen-character label plus `11:21 AM` wants ~13× the type
size; the time column alone wants ~5×), and nothing in that band would have
clipped anything.

What the width term protects is the **time column plus its gap**, and
nothing else. The label track is `1fr` with `min-w-0 overflow-hidden`: it
exists to absorb exactly this, and a truncated label is what its clip has
always been for. So in a box too narrow for the whole table, a long label
gets cut rather than the whole table getting smaller — which on a board
read from twenty feet is the better of the two, and is the only reading
under which narrowing a roomy box changes nothing.

That also removed a day-to-day wobble as a side effect: the old term was
measured from the widest label PRESENT, so a Friday's "Candle Lighting"
shrank a width-bound table. The time column is the same width on every
date, so nothing about a returning row can move the size now.

`scripts/test-zmanim-layout.mjs` measures all of this in a real browser —
the same widths walked down through that band, against
`data-fitted-size` — because the arithmetic being right is only half of the
claim.

The eight is the one judgement call: a table filling a third of a
1080-unit board is 360 units, which at eight rows is roughly 45-unit type,
legible at the twenty feet design.md §1 is written for. Fewer than eight
rows selected leaves space at the bottom, which is honest — closing it
would mean the size depending on the row count again.

**This is why the spacer rows below are gone.** Three passes are recorded
here rather than the last overwriting the others, because each was right
about something the next one needed.

**The Zmanim widget shipped, and it recommends `fit` — which took two
passes to get right, so both are recorded.**

This paragraph's reasoning is still correct as far as it goes, and it is
one row short. Two of the canonical zmanim a table can contain,
`candle_lighting` and `shabbos_ends`, exist on some dates and not others,
so a selection containing either has a row count that differs between the
Tuesday the box was sized on and the Friday a room is reading it. That part
of the count is not a design-time choice.

**The first conclusion was to refuse `fit` and default to `hug`,** because
a fitted table's type size depends on its row count, so it would rescale
every Friday and rescale back every Sunday — Clock's "worst possible
behavior for the most-watched element" applied to a table.

**The second conclusion, which is what shipped, was that fit does not have
to re-measure at all.** The widget pads its measured list to the DECLARED
selection count with zero-content spacer rows, and the declared count is a
design-time constant and an upper bound on any day's real count — a
date-conditional row can only be absent, never extra. Friday's returning
row lands in a spacer's place and the type size does not move. Fit's
dependencies are the box and the declared selection; today's rows are not
among them. So `fit` is recommended (`sizing.recommended` in the manifest
puts that under the panel's toggle), `fixed` and `hug` stay fully honest
and offered, and nothing is refused for the table.

**The one place fit is still not recommended is the widget's "next one
only" mode.** One row, so nothing about the count varies — but that row's
own label changes through the day ("Sunrise", "Latest Shacharit",
"Midnight"), and a fitted single row rescales with its label's length. The
panel says so rather than switching the mode: all three are legible for one
row and only one is jumpy.

**THE THIRD PASS, and what shipped: the spacers are gone too.** Under the
four rules above the size does not depend on the row count at ALL — the
height term takes a per-row height and no count, so a returning
candle-lighting row cannot move it. The spacers had nothing left to hold
steady, and they would now actively hurt: a spacer inflates the content
height the overflow check reads, so a table that genuinely fits would
scroll.

One residual day-to-day change remains and is rule 3 doing its job rather
than the instability spacers guarded against: the width term measures the
widest row PRESENT, so on a Friday, when "Candle Lighting" is on the board,
a width-constrained table gets slightly smaller type. That happens only
when width binds — i.e. when the alternative is clipping, which rule 3
forbids outright.

**A separate axis carries what fit used to have to absorb: an overflow
mode** — page through a screenful at a time, scroll continuously, or clip
per §3 below. Sizing decides how big the type is; overflow decides what
happens to rows that still don't fit at that size, which under rule 4 is a
routine outcome rather than an edge. Both moving modes drive off the master
second tick (plan.md §3e) and neither creates a timer, and both are inert
when the rows do fit — which is why paging can be the default without
putting motion on boards that don't need it.

**The scroll offset is derived from ELAPSED time since the widget started
scrolling, never from the absolute tick.** That was a real bug, not a
nicety: `(second * speed) % height` off the epoch is in range but arbitrary
at any given moment, so the first frame after measurement jumped from
nothing to 224px (measured) and CSS interpolated the whole distance over
one second — a fourteen-times sweep through the list, then a settle to the
real rate, which reads as stopping.

### `hug` — content drives the box, and the box resizes to match

The declared type size is authoritative, same as `fixed`. But instead of the
box being an independent boundary that clips whatever doesn't fit, **the box's
height** resizes to exactly contain the content at that size. Width keeps
`fixed`'s job — a wrap boundary — because hugging both axes for wrapped text has
no single right answer (does the box also get narrower? which line decides?),
and a fixed width is what makes "wrap, then hug the height that took" a coherent
sentence in the first place.

This is the mode for content whose amount, not whose row design, changes at
runtime: a shul with three notices posted today and one next week, or a message
board whose queue drains and refills. `fixed` forces a choice between a box
sized for the busy week (mostly empty most of the time) and one sized for the
quiet week (clipping the busy one) — `hug` needs neither choice, because
**overflow is structurally impossible in this mode rather than something to
warn about.** The box can't be too small for its content; it's computed from
it.

**Applies to: Announcements/Notices, Message Board** — both are lists whose
row count is an editorial decision made independently of the board, on its own
schedule, exactly the "content whose length changes over time" problem §1
opens with.

**Clock also offers `hug`, as a non-default option alongside `fit` and
`fixed`.** This looks like it should reintroduce §1's jitter problem and
doesn't, because hugging is height-only and a clock is one line: the digit
count that changes width (`12:00` → `1:00`) never touches height, which is
exactly the same at any hour. What `hug` buys a clock is narrower than what it
buys a notice list — not "never overflows" (`fixed` rarely overflows a
sensibly-sized clock box either) but "the box is never a little too tall or a
little too short for the line it holds," which `fixed` leaves to however
carefully the box was dragged. `fixed` stays the default; §7 records why hug
mode's own overflow check treats a hugged clock's height as unconditionally
fine rather than measuring it.

### The toggle

Where more than one mode is defensible — Clock, Date, Day of Week, Hebrew
Date — the element exposes a **Fit to box / Fixed size / Hug height** control
in the properties panel. The manifest declares which is the default.

**Clock defaults to `fixed`.** A clock in `fit` mode would rescale its type every
time the digit count changes, which is the worst possible behavior for the single
most-watched element on the board.

### An objective, visible type size — every element, every mode

The properties panel shows a **Type size** field for every text-bearing
element, in board design units, regardless of which mode it's in:

- **`fit`:** the computed result, read live off the rendered box. Read-only —
  the box is what's authoritative here, so the field is for reading the number,
  not setting it.
- **`fixed` and `hug`:** the declared value, editable, and the same field that
  drives the render.

Before this, `fit`-mode elements (Title) showed no size at all, and a
`fixed`-mode element's size field (Clock) went disabled-and-stale rather than
live in `fit` mode — a gabbai could never actually read what size their type
had landed on. One number, one place, honest in every mode, is the whole
requirement; this section's own "big enough to read from the back" philosophy
for `fit` doesn't mean the number shouldn't exist, just that nobody has to
*think* in it to use `fit` mode.

Generic in the panel itself (`components/editor/PropertiesPanel.tsx`'s
`TypeSizeField`), not duplicated into each widget's own Settings.tsx, for the
same reason the Fit/Fixed/Hug toggle already is — every widget that names its
authoritative field `size` and its mode field `sizingMode` (clock/manifest.ts's
convention) gets this for free. It shows for a `text`- or `time`-category
widget; `media` (Image, and later Video/Gallery/Collage) is exactly the
category §2 already says has no font size for a mode to drive. That's a
heuristic on `WidgetCategory`, not a manifest flag, because no widget needs a
flag yet — worth promoting to one the day a `content`-category widget (a
Zmanim table, with a size per row rather than one scalar) needs a genuinely
different shape than a single number.

### Manifest addition

```ts
sizing: {
  mode: 'fit' | 'fixed' | 'hug'
  userToggleable: boolean
  minFontSize?: number   // design units, for fit mode
  maxFontSize?: number
}
```

### Editor affordance

An element in `fit` mode should make that legible while resizing — the type
visibly scaling as the handle moves is self-explanatory and needs no label. An
element in `fixed` mode should show its wrap boundary while resizing so it's
clear the box is a frame, not a scaler. An element in `hug` mode resizing its
own height by dragging is a contradiction the editor doesn't yet resolve —
recorded in §7, "Known deviations," rather than solved here.

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

Separate problem, separate mechanism. This applies in **every** sizing mode,
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

**`hug` mode is the one place the box itself is the thing growing**, and the
same rule still names the answer: the box grows away from its alignment edge,
the edge stays put. Today that only ever means the top edge — `hug`-mode
widgets have no vertical-alignment setting yet, only the horizontal one this
table was written for, so a hugged box's top simply never moves and height
grows down, which is what an absolutely positioned box with `height: auto`
and no `bottom` does on its own. A vertical-alignment control, if one is
added, generalizes this table's other three rows to a growing box the same
way it already generalizes them to content within a fixed one.

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
- **`hug` mode:** height can't overflow — that's the mode's whole point (§2).
  Width still can, same as `fixed`: wrap, then clip at the box's own width.
- **Never** grow the box in `fit` or `fixed` mode. A board is a designed
  composition and elements silently resizing would break the layout around
  them — `hug` mode is the one deliberate exception (§2), and only for height.
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

**Re-measured on the board, not inherited from the chrome measurement.**
design.md §3 settled this for dashboard chrome; the board is a different
context — its own font tokens, its own `cqw` sizing — and the Zmanim
widget's right-aligned column of times depends on it being true there too.
`scripts/test-font-parity.mjs` now reads `11111` against `00000` inside the
real board at 15px: the sefarim face closes a **6.97px spread to 0.00px**
under `tabular-nums`, while the UI face is **3.08px either way,
unchanged**. So a column of times gets its clean edge from setting the
sefarim face, and the utility class alone would do nothing. CLAUDE.md's
caveat is load-bearing on the board as well as in chrome.

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

Four places the implementation doesn't follow this document to the letter.
All are deliberate. Recorded here so none gets "fixed" by a session that
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

**A `hug`-mode element's height overflow check is skipped, not just usually
false.** §3's editor warning ("flag in the properties panel") measures a
box's `scrollHeight` against its `clientHeight`; for a `hug` box those can
differ by a few pixels from line-height and glyph-metrics rounding alone in
an auto-height flex box, with nothing actually clipped — a false warning on a
widget that looks completely fine. The height that check would flag can
never genuinely overflow when it's computed from that exact content in the
first place, so the check can only produce noise, never a true positive; it's
skipped rather than tuned, and width — which `hug` does not hug — still gets
the real check.

**A `hug`-mode element's own height resize handles do nothing durable.** The
box's rendered height is computed from its content at the declared type size
(`components/board/BoardRenderer.tsx`), not read from the document's stored
`h` — so a corner or edge drag that changes height commits a new `h` to the
document exactly as it would for any other widget, and the very next render
throws that value away and recomputes the hugged height anyway. Harmless
(nothing is lost that mattered) but also pointless from where the person
dragging is standing, and the selection outline itself is drawn from that
same stored, soon-to-be-ignored `h`, so it can visibly disagree with the
rendered box between the drag and the widget's next real edit. Worth an
editor affordance — disabling the height handles for a `hug`-mode widget,
the way most design tools do for an axis they auto-size — once a `hug`-mode
widget actually ships and someone hits this by hand rather than by reading
the code; not before.
