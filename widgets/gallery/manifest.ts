import { z } from "zod";
import { widgetStyleFields } from "../style";
import type { DataNeed, WidgetManifest } from "../types";

/*
 * Gallery — one album, one photo at a time, in a designated area of the board,
 * cycling on a timer (plan.md §6: "widgets bind to an album, and auto-fill
 * widgets re-roll their selection on a timer so a board shows fresh photos for
 * weeks untouched"). The Collage widget is the same album, several photos at
 * once; this is the single-photo case.
 */

export const galleryConfigSchema = z.object({
  /** The album this gallery shows. Empty until one is picked. */
  albumId: z.string().max(64).default(""),
  /** cover fills the box (cropping); contain fits the whole photo (letterboxed). */
  fit: z.enum(["cover", "contain"]).default("cover"),
  /** Seconds each photo holds before the next. */
  intervalSeconds: z.number().min(2).max(600).default(8),
  /** Cycle in album order, or a stable shuffle. */
  order: z.enum(["album", "shuffle"]).default("album"),
  /** Show the photo's caption over the image. */
  showCaption: z.boolean().default(false),
  // Background, colour, font, padding, radius, border, shadow, header — shared
  // appearance for every widget (../style.ts).
  ...widgetStyleFields,
});

export type GalleryConfig = z.infer<typeof galleryConfigSchema>;

/** Needs its album's photos resolved into the bundle (and the editor preview) —
 *  see lib/media/album-photos.ts. Nothing to fetch until an album is picked. */
function dataNeeds(config: GalleryConfig): readonly DataNeed[] {
  return config.albumId ? [{ kind: "album", albumId: config.albumId }] : [];
}

export const manifest: WidgetManifest<GalleryConfig> = {
  id: "gallery",
  name: "Gallery",
  description: "Photos from an album, one at a time in a frame you place.",
  category: "media",
  defaultSize: { w: 640, h: 480 },
  isPro: false,
  settingsSchema: galleryConfigSchema,
  dataNeeds,
  /**
   * Media has no text size for a mode to drive — the photo fills the box via
   * object-fit, the same as Image (which declares `fit` for completeness and
   * means nothing by it). Not toggleable.
   */
  sizing: { mode: "fit", userToggleable: false },
  instanceLabel: () => "Gallery",
};
