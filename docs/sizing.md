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

## 6. Naming: "widget" vs "element"

Open question, worth settling before the term spreads further.

- **In code** — folders, manifest types, registry, `dataNeeds` — "widget" is
  accurate. A Zmanim block is a live data component, not a static element.
- **In the editor UI**, where a gabbai reads it, "element" is friendlier and
  matches what design tools call things.

Whichever is chosen, it should be consistent within each layer. Renaming code
later is a large mechanical diff; renaming UI strings is cheap. So: decide the UI
term now, and leave the code term alone unless there's a strong reason.
