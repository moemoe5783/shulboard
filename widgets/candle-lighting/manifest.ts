import { z } from "zod";
import { hour12Schema, nekudosSchema, scriptSchema } from "@/lib/hebrew/format";
import { widgetStyleFields } from "../style";
import type { DataNeed, WidgetManifest } from "../types";

/**
 * Which zmanim source this instance uses — plan.md §5c's "per-widget
 * override".
 *
 * UNREAD, AND KEPT ON PURPOSE. Chabad.org is the only source
 * (lib/zmanim/provider.ts), so there is nothing to override and the
 * Settings panel no longer offers the choice — a one-item dropdown is not
 * a setting. The field stays in the schema, with all four values, for the
 * same reason the DB enum keeps them: a stored board document written
 * while the choice existed still parses, and re-offering the choice later
 * is a Settings control plus a read here, not a document migration.
 *
 * Nothing may branch on this. `dataNeeds` below used to and no longer
 * does.
 */
export const candleLightingProviderSchema = z.enum(["inherit", "hebcal", "chabad", "manual"]).default("inherit");

export const candleLightingConfigSchema = z.object({
  /** The "Candle lighting" label's own language — the time itself has no
   *  script, only numerals, so there is no separate numerals option here. */
  script: scriptSchema,
  /** Only affects the Hebrew half of the label. */
  nekudos: nekudosSchema,
  hour12: hour12Schema,
  showCountdown: z.boolean().default(true),
  /**
   * Also show the Shabbos/Yom-Tov end (Havdalah) time, interleaved in time
   * order with the candle lighting(s) — off by default, because the widget's
   * name is "candle lighting" and a shul that wants the end time asks for it.
   * The time comes from Chabad's four-week embed (lib/zmanim/chabad-embed.ts);
   * hebcal only says which dates end a Shabbos or Yom Tov.
   */
  showShabbosEnd: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("center"),
  /** Design pixels — used only for the empty-state message's size now. The
   *  time block itself is always fit-to-box (see `sizing`); the box is what
   *  sets its size. Kept in the schema so stored documents keep parsing, and
   *  read by PropertiesPanel to resize the box to a typed size. */
  size: z.number().min(8).max(400).default(72),
  provider: candleLightingProviderSchema,
  /** Minutes before sunset — the Manual provider's own field, unread for
   *  the same reason `provider` is. Chabad publishes candle lighting 18
   *  minutes before sunset itself (its request's own `before=18`), so
   *  there is nothing for this to adjust. */
  manualMinutesBeforeSunset: z.number().min(0).max(180).default(18),
  /**
   * How many of the week's candle lightings to show at once.
   *
   * A week routinely has more than one: Erev Yom Kippur on a Sunday sits
   * in the same week as the Friday before it, and a two-day Yom Tov
   * abutting Shabbos produces a run. `"next"` is the behaviour before this
   * existed.
   *
   * `"all"` STACKS, AND THE FIT HANDLES THE VARYING COUNT. The entry count
   * varies week to week (one most weeks, two or three around the chagim, and
   * more once Shabbos ends are interleaved). With fit-to-box as the only
   * sizing mode, that is no longer a special case: a busier week renders
   * smaller so the whole stack stays visible, the same shrink a smaller box
   * produces (widgets/useFitFontSize.ts). No mode switch, no clipping.
   */
  displayMode: z.enum(["next", "all", "rotate"]).default("next"),
  // Background, text colour, font, padding, radius — board content, shared
  // with zmanim (../style.ts).
  ...widgetStyleFields,
});

export type CandleLightingConfig = z.infer<typeof candleLightingConfigSchema>;

/**
 * Unconditional now. This used to check the widget's own `provider`
 * against "chabad" or "inherit" — deliberately over-inclusive, because a
 * `dataNeeds` function only ever sees its own instance's config (plan.md
 * §5's contract) and could not tell what "inherit" resolved to. With
 * Chabad.org the only source, every instance of this widget needs the
 * cache and the branch had one outcome.
 */
function dataNeeds(): readonly DataNeed[] {
  return [{ kind: "zmanim", provider: "chabad" }];
}

export const manifest: WidgetManifest<CandleLightingConfig> = {
  id: "candle-lighting",
  name: "Candle lighting",
  description: "Candle-lighting times, with a countdown.",
  category: "time",
  defaultSize: { w: 640, h: 220 },
  isPro: false,
  settingsSchema: candleLightingConfigSchema,
  dataNeeds,
  /**
   * FIT TO BOX, AND ONLY FIT TO BOX — the same rule zmanim now follows. The
   * time block (label, time, countdown, any Shabbos-end rows) always scales so
   * the whole thing fits the box, shrinking as far as it must so nothing is cut
   * off (widgets/useFitFontSize.ts). Fixed and Hug are gone.
   *
   * The countdown's own digit count changing shape ("in 2h 15m" -> "in 9m" ->
   * "in 42s") was the argument for `fixed` here. It re-fits on each change, and
   * a countdown that renders one step smaller as it lengthens is far less
   * jarring than the clipping the old fixed default produced on a busy week or
   * a small box.
   *
   * `userToggleable: false`, so the panel shows no mode switch. The "Type size"
   * field it does show is editable and resizes the BOX to that size
   * (PropertiesPanel): enter a size and the box grows or shrinks so the content
   * renders at it; on the board, if content later grows, the type shrinks to
   * fit rather than overflowing.
   */
  sizing: { mode: "fit", userToggleable: false, minFontSize: 8, maxFontSize: 400 },
};
