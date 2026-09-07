/*
 * Editor chrome — docs/design.md §4, "Editor".
 *
 * "Dark chrome, light canvas. This is the one place the pattern is correct
 * rather than borrowed: the board being designed should be the brightest object
 * on screen, and dark chrome makes the canvas read as the artifact."
 *
 * So the dashboard's Button primitive does not apply here — its secondary is
 * --ink text, which is invisible on an --ink bar. These are the same geometry
 * (32px high, 5px radius, 14px label) with the palette inverted: --paper for
 * text, and washes of --paper where the dashboard would wash --verdigris.
 *
 * Every value is a token, some with an alpha. No new colour enters the product:
 * a hairline on dark chrome is --paper at 15%, because --rule is ink at 10% and
 * would be invisible here.
 */

export const CHROME_SURFACE = "bg-ink text-paper";

export const CHROME_RULE = "border-paper/15";

/** Marks a region that sits on --ink, so its focus ring switches to
 *  --focus-dark. See app/globals.css. */
export const CHROME_DARK = { "data-dark-chrome": "" } as const;

/** A chrome control. Same 32px height and 5px radius as everything else. */
export const CHROME_BUTTON =
  "text-cell rounded-control text-paper inline-flex h-8 shrink-0 items-center justify-center " +
  "px-2 whitespace-nowrap enabled:hover:bg-paper/10 disabled:text-paper/35 disabled:cursor-not-allowed";

/**
 * A toggle that is currently on.
 *
 * --verdigris-wash behind --verdigris text, exactly what the dashboard rail
 * gives its active item. NOT a verdigris fill: a fill is the primary-action
 * treatment, and two filled toggles beside each other read as two primary
 * actions in a view that is supposed to have at most one. Verdigris still means
 * "this is on"; it just says it the way the rest of the product does.
 */
// The hover override is load-bearing: CHROME_BUTTON carries
// enabled:hover:bg-paper/10, and a hover variant outranks a plain background
// whatever order the classes are written in — so without it, hovering a
// switched-on toggle makes it look switched off.
export const CHROME_BUTTON_ON =
  "bg-verdigris-wash text-verdigris enabled:hover:bg-verdigris-wash";

/**
 * The one primary action in editor chrome — publish (design.md §4's wireframe:
 * "Saved [Publish]"). A verdigris fill with light text, the same treatment
 * Button.tsx's primary variant gives the dashboard, and the fill CHROME_BUTTON_ON
 * deliberately avoids: that comment draws the line between a toggle's state
 * (wash) and a genuine action (fill), and publish is the fill side of it.
 */
export const CHROME_BUTTON_PRIMARY =
  "text-cell rounded-control bg-verdigris text-surface inline-flex h-8 shrink-0 items-center " +
  "justify-center px-3 whitespace-nowrap enabled:hover:bg-verdigris-deep disabled:bg-verdigris/40 " +
  "disabled:cursor-not-allowed";

/** Metadata on dark chrome. --ink-soft is the dashboard's answer and reads as
 *  mud here; --paper at 60% is the same relationship the other way up. */
export const CHROME_META = "text-meta text-paper/60";
