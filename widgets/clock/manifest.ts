import { z } from "zod";
import type { WidgetManifest } from "../types";

export const clockConfigSchema = z.object({
  hour12: z.boolean().default(true),
  showSeconds: z.boolean().default(false),
  /** An IANA zone. Empty means the device's own, which is what a screen hanging
   *  in the building it serves should use. */
  timeZone: z.string().max(64).default(""),
  size: z.number().min(8).max(400).default(140),
  align: z.enum(["left", "center", "right"]).default("center"),
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
   * Nothing is fetched — §3b: the clock is computed in the browser from the
   * system clock and needs no network, ever. The declaration is here so the
   * bundle builder knows the screen's zone is worth resolving once for every
   * widget that wants it rather than per widget.
   */
  dataNeeds: ["timezone"],
};
