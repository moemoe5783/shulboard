import { z } from "zod";
import { widgetStyleFields } from "../style";
import type { DataNeed, WidgetManifest } from "../types";

/*
 * Collage — several photos from one album, fitted into a frame you place,
 * arranged by a template chosen to suit the photos' shapes (plan.md §7). The
 * single-photo case is the Gallery widget; this is the many-at-once case, and
 * like Gallery it re-rolls its selection on a timer so the wall stays fresh.
 */

export const collageConfigSchema = z.object({
  albumId: z.string().max(64).default(""),
  /** How many photos to show at once (the template library covers up to 6). */
  count: z.number().int().min(1).max(6).default(4),
  /** Seconds before re-rolling to a fresh set of photos. 0 never re-rolls. */
  intervalSeconds: z.number().min(0).max(3600).default(20),
  /** Space between photos, in board design units. */
  gutter: z.number().min(0).max(60).default(8),
  /** Corner radius on each photo, in board design units. */
  photoRadius: z.number().min(0).max(80).default(6),
  // Background, colour, font, padding, border, shadow, header — shared
  // appearance for every widget (../style.ts). The widget frame's own radius is
  // separate from `photoRadius`, which rounds the individual photos.
  ...widgetStyleFields,
});

export type CollageConfig = z.infer<typeof collageConfigSchema>;

function dataNeeds(config: CollageConfig): readonly DataNeed[] {
  return config.albumId ? [{ kind: "album", albumId: config.albumId }] : [];
}

export const manifest: WidgetManifest<CollageConfig> = {
  id: "collage",
  name: "Collage",
  description: "Several photos from an album, fitted together in one frame.",
  category: "media",
  defaultSize: { w: 960, h: 540 },
  isPro: false,
  settingsSchema: collageConfigSchema,
  dataNeeds,
  sizing: { mode: "fit", userToggleable: false },
  instanceLabel: () => "Collage",
};
