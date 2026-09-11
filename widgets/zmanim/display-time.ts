/*
 * Splitting a provider's time string into the columns it has to line up in.
 *
 * THE PROBLEM THIS SOLVES, reported from a live board: right-aligning the
 * whole string does not give a straight edge. "7:22 PM" and "11:21 AM" are
 * the same shape but not the same length, so aligning their right-hand
 * ends leaves the two-digit hour hanging a digit's width out to the left of
 * every single-digit one. The column reads ragged even though every glyph
 * is a tabular figure, because the raggedness is in the hour, not in the
 * metrics.
 *
 * The fix is structural: the hour, the ":MM", and the meridiem each get
 * their own grid track shared by every row, so the hours right-align
 * against a common colon and the outer edge is straight whatever the hour's
 * width. That needs the string in three pieces, which is all this does.
 *
 * NOTHING IS REFORMATTED, and that is a hard rule rather than caution —
 * plan.md §5c: "never re-round or recompute provider output. Display
 * verbatim." So this SPLITS and never rewrites: the three pieces
 * concatenate back to the exact string Chabad sent, separator spacing
 * included, which is what `scripts/test-zmanim-widget.ts` asserts against
 * every value in the 92-day fixture. Laying the same characters out in
 * columns is display; changing them would be a different claim about what
 * time it is.
 */

/** A time string's three columns, or `null` for a string this does not
 *  recognise. The pieces always rejoin to the original. */
export type TimeColumns = {
  /** The hour, with no padding added — "7" stays "7". */
  hours: string;
  /** The colon and the minutes, and the seconds if the provider sent any.
   *  Kept together so the colon's position is fixed by the track, not by
   *  the hour beside it. */
  minutes: string;
  /** Everything after the minutes, INCLUDING its leading space: " PM".
   *  Empty for a 24-hour string. The space is the provider's, so it is
   *  rendered with `white-space: pre` rather than reinvented as padding. */
  meridiem: string;
};

/**
 * `H:MM`, optional `:SS`, then anything. Deliberately loose about the
 * tail: Chabad sends " AM"/" PM" today, and a suffix nobody has seen yet
 * should land in the meridiem column rather than fail the whole match and
 * lose the alignment.
 */
const CLOCK = /^(\d{1,2})(:\d{2}(?::\d{2})?)(.*)$/;

/**
 * Splits a provider time string for the alignment grid.
 *
 * Returns `null` when the string is not clock-shaped, and the Renderer
 * falls back to printing it whole across the three tracks. That path is
 * reachable: `ShaahZmanit` is a duration ("62:51 min.") and, although it
 * is not offered in this widget (plan.md §5c), an unrecognised shape must
 * degrade to "printed, unaligned" rather than to "not printed".
 */
export function splitTimeColumns(display: string): TimeColumns | null {
  const match = CLOCK.exec(display);
  if (!match) return null;
  return { hours: match[1], minutes: match[2], meridiem: match[3] };
}
