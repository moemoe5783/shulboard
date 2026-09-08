import { z } from "zod";
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
   * docs/sizing.md §2: defaults to `fixed` because a clock in `fit` mode would
   * rescale its type every time the digit count changes (12:00 → 1:00,
   * losing a character) — "the worst possible behavior for the single
   * most-watched element on the board." All three modes are still
   * defensible, so it's toggleable, unlike Title.
   */
  sizing: { mode: "fixed", userToggleable: true, minFontSize: 24, maxFontSize: 400 },
};
