import { z } from "zod";
import { widgetStyleFields } from "../style";
import type { WidgetManifest } from "../types";

export const clockConfigSchema = z.object({
  hour12: z.boolean().default(true),
  showSeconds: z.boolean().default(false),
  /** An IANA zone. Empty means the device's own, which is what a screen hanging
   *  in the building it serves should use. */
  timeZone: z.string().max(64).default(""),
  /** Design pixels. Read in `fixed` and `hug` modes — docs/sizing.md §2, "the
   *  declared type size is authoritative." Ignored in `fit`. */
  size: z.number().min(8).max(400).default(140),
  align: z.enum(["left", "center", "right"]).default("center"),
  /**
   * Per-instance override of the manifest's default sizing mode
   * (docs/sizing.md §2, "The toggle"). The manifest states the default so a
   * brand-new clock behaves correctly with nothing set; this field only
   * exists once someone has actually flipped it in the properties panel.
   *
   * `hug` is offered alongside `fit`/`fixed` because it hugs height only
   * (docs/sizing.md §2) — a clock is one line, so its height never depends on
   * the digit count the way its width does, and hugging removes the one
   * failure mode `fixed` still has here: a dragged box a little too short or
   * too tall for the line it holds.
   */
  sizingMode: z.enum(["fit", "fixed", "hug"]).default("fixed"),
  // Background, colour, font, padding, radius, border, shadow and header —
  // shared appearance for every widget (../style.ts), applied by
  // BoardRenderer.WidgetFrame.
  ...widgetStyleFields,
});

export type ClockConfig = z.infer<typeof clockConfigSchema>;

export const manifest: WidgetManifest<ClockConfig> = {
  id: "clock",
  name: "Clock",
  description: "The current time, ticking.",
  category: "time",
  defaultSize: { w: 520, h: 220 },
  isPro: false,
  settingsSchema: clockConfigSchema,
  // Times, zmanim or a date: no script faces offered, lining digits (widgets/types.ts).
  showsTimes: true,
  /**
   * Nothing is fetched over the network — §3b: the clock is computed in the
   * browser from the system clock and needs no network, ever. The declaration
   * says which zone it wants resolved, so twelve clocks all showing the
   * building's own time resolve it once rather than twelve times.
   *
   * null means the device's own zone, which is what a screen hanging in the
   * building it serves should use. It is a distinct need from a named zone, and
   * writing it as null rather than "" keeps that distinction legible.
   */
  dataNeeds: (config) => [{ kind: "timezone", timeZone: config.timeZone || null }],
  /**
   * docs/sizing.md §2: defaults to `fixed`. `fit` used to rescale the type
   * every time the digit count changed (12:00 → 1:00); it now fits the
   * widest time the format can show, so it holds still, but `fixed` stays the
   * default. All three modes are defensible, so it's toggleable, unlike
   * Title. `maxFontSize` is `fit`'s ceiling only — high enough that a clock
   * filling a screen still follows its box.
   */
  sizing: { mode: "fixed", userToggleable: true, minFontSize: 24, maxFontSize: 1080 },
};
