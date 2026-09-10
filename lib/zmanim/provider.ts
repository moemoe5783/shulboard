/*
 * Which zmanim providers this product actually offers — one place, because
 * the answer is currently "one" and that is a decision to be able to
 * reverse in a single file rather than a shape baked into twenty.
 *
 * CHABAD.ORG IS THE ONLY SOURCE FOR ZMANIM AND CANDLE LIGHTING. Hebcal and
 * Manual are gone as PROVIDERS: nothing offers them in a settings form,
 * nothing resolves to them, and no widget computes a zman.
 *
 * THIS IS NOT A REMOVAL OF @hebcal/core, which is load-bearing elsewhere
 * and untouched. It still computes Hebrew dates, the parsha and the daf
 * (widgets/hebrew-date, widgets/parsha, widgets/daf-yomi — plan.md §3b's
 * "computed in the browser, no network needed, ever"), and it still tells
 * candle lighting WHICH dates are candle-lighting dates. What it no longer
 * does is supply a zman's VALUE. The line is: hebcal is the calendar,
 * Chabad is the clock.
 *
 * `lib/zmanim/hebcal-zmanim.ts` is the zmanim computation, kept in the repo
 * and unwired for the day this reverses.
 */

/** The `zmanim_provider` enum values a person may actually choose today. */
export const ENABLED_ZMANIM_PROVIDERS = ["chabad"] as const;

export type ZmanimProvider = "hebcal" | "chabad" | "myzmanim" | "manual";

/**
 * What a stored `zmanim_provider` resolves to at render time.
 *
 * IT IGNORES ITS ARGUMENT, ON PURPOSE, and that is the whole mechanism.
 * `orgs.zmanim_provider` and `screens.zmanim_provider` still hold whatever
 * they held — the DB enum keeps all four values and no migration touches
 * any row — but only one of them can be served, so every read funnels
 * through here instead of branching on the column.
 *
 * WHAT THIS MEANS FOR AN ORG ALREADY ON 'hebcal' (the schema default, so
 * every org that never opened the setting): it is served as Chabad. That
 * is the only answer that doesn't leave a board rendering nothing — there
 * is no Hebcal zmanim path left to fall back to, so honouring the stored
 * value would mean a blank widget with no explanation. Such an org very
 * likely has no ZIP on file either, and that case already has an honest
 * empty state naming exactly what to do ("This shul hasn't set a ZIP or
 * Chabad.org location yet"), which is now the one thing the settings page
 * asks for.
 *
 * When Hebcal or Manual come back, this function reads its argument again
 * and every caller is already correct.
 */
export function effectiveZmanimProvider(stored: string | null | undefined): "chabad" {
  // Read and deliberately discarded. The parameter exists so every caller
  // is already passing the right thing on the day this reads it again.
  void stored;
  return "chabad";
}
