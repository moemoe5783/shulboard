import { z } from "zod";
import type { WidgetManifest } from "../types";

/*
 * Title — a heading and an optional line under it.
 *
 * The plainest widget there is, which makes it the one to copy when adding the
 * fourth. Every field carries a .default(), so parse({}) is the default config
 * and there is no second list of defaults to drift.
 */

export const titleConfigSchema = z.object({
  text: z.string().max(200).default("Untitled"),
  subtitle: z.string().max(200).default(""),
  align: z.enum(["left", "center", "right"]).default("left"),
  /** Design pixels on the board's canvas — 1920 wide by default, so 72 here is
   *  72px on a 1080p screen and scales with everything else. */
  size: z.number().min(8).max(400).default(72),
  /** Sub-line size, as a fraction of the title's. */
  subtitleScale: z.number().min(0.1).max(1).default(0.45),
});

export type TitleConfig = z.infer<typeof titleConfigSchema>;

export const manifest: WidgetManifest<TitleConfig> = {
  id: "title",
  name: "Title",
  description: "A heading, with a line under it if you want one.",
  category: "text",
  defaultSize: { w: 800, h: 200 },
  isPro: false,
  settingsSchema: titleConfigSchema,
  // Nothing to fetch. It says what it is told to say.
  dataNeeds: () => [],
  instanceLabel: (config) => config.text || "Title",
};
