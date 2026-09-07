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
};
