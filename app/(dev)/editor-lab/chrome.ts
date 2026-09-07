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

/** A chrome control. Same 32px height and 5px radius as everything else. */
export const CHROME_BUTTON =
  "text-cell rounded-control text-paper inline-flex h-8 shrink-0 items-center justify-center " +
  "px-2 whitespace-nowrap enabled:hover:bg-paper/10 disabled:text-paper/35 disabled:cursor-not-allowed";

/** A toggle that is currently on. Verdigris still means "this one is active",
 *  the same job it does in the dashboard rail. */
export const CHROME_BUTTON_ON = "bg-verdigris text-paper";

/** Metadata on dark chrome. --ink-soft is the dashboard's answer and reads as
 *  mud here; --paper at 60% is the same relationship the other way up. */
export const CHROME_META = "text-meta text-paper/60";
