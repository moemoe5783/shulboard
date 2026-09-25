import { z } from "zod";
import { widgetStyleFields } from "../style";
import type { WidgetManifest } from "../types";

/*
 * QR code — a link a phone can open from across the room: the shul's
 * donation page, a sign-up form, a shiur's recording.
 *
 * Drawn in the browser from the link itself (uqr, no network), so it works
 * offline like the clock does and needs nothing in the bundle. The colours are
 * board content (design.md §1b); the Settings panel warns when they'd stop a
 * phone reading it.
 */

export const qrCodeConfigSchema = z.object({
  /** What the code opens — usually a web address, but any text works. */
  value: z.string().max(1200).default(""),
  /** How much damage the code survives: more means denser. `M` reads well from
   *  a distance and tolerates a smudged screen. */
  errorCorrection: z.enum(["L", "M", "Q", "H"]).default("M"),
  /** The dark squares. */
  darkColor: z.string().max(64).default("#000000"),
  /** The light squares and the margin around them. */
  lightColor: z.string().max(64).default("#ffffff"),
  /** The clear margin, in squares. Scanners want about four; two is usually
   *  enough on a screen with a plain background around it. */
  margin: z.number().int().min(0).max(8).default(2),
  /** A line under the code — "Scan to donate". */
  caption: z.string().max(120).default(""),
  /** The caption's size, in design units. */
  captionSize: z.number().min(8).max(200).default(32),
  /** The space between the code and its caption, as a multiple of the
   *  caption's size. */
  captionGap: z.number().min(0).max(3).default(0.3),
  // Frame appearance for every widget (../style.ts) — separate from the code's
  // own two colours above.
  ...widgetStyleFields,
});

export type QrCodeConfig = z.infer<typeof qrCodeConfigSchema>;

export const manifest: WidgetManifest<QrCodeConfig> = {
  id: "qr-code",
  name: "QR code",
  description: "A code phones can scan to open a link.",
  category: "content",
  defaultSize: { w: 360, h: 420 },
  isPro: false,
  settingsSchema: qrCodeConfigSchema,
  // Drawn from the config alone.
  dataNeeds: () => [],
  /** The code scales to fill its box, square; there's no type size to drive. */
  sizing: { mode: "fit", userToggleable: false },
  instanceLabel: (config) => config.caption || "QR code",
};
