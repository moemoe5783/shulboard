import "@hebcal/learning/dafYomi";
import { DailyLearning, type HDate } from "@hebcal/core";
import { DafPageEvent } from "@hebcal/learning";

/*
 * @hebcal/core itself ships no learning schedules (plan.md says "Use
 * @hebcal/core", but its own DailyLearning.d.ts is explicit that Daf Yomi is
 * a plug-in from the separate, same-publisher `@hebcal/learning` package,
 * registered by this side-effect import). Only the `dafYomi` subpath, not the
 * whole package — the bare `@hebcal/learning` registers twenty other daily
 * schedules (Mishna Yomi, Nach Yomi, Rambam...) this product doesn't use, and
 * this runs in a browser on a TV that stays open for months.
 *
 * The cycle began 11 September 1923 (1 Tishrei 5684); a date before that
 * returns null, which cannot happen for "today" on any board this product
 * will ever run on.
 */
export function dafYomiFor(hdate: HDate): DafPageEvent | null {
  const event = DailyLearning.lookup("dafyomi", hdate, false);
  return event instanceof DafPageEvent ? event : null;
}
