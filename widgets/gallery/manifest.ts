import { z } from "zod";
import { albumSelectionFields, albumSelectionNeeds } from "@/lib/media/selection";
import { CLEAN_TRANSITIONS, TRANSITION_SPEED_MAX, TRANSITION_SPEED_MIN } from "../collage/transitions";
import { widgetStyleFields } from "../style";
import type { DataNeed, WidgetManifest } from "../types";

/*
 * Gallery — photos from one or more albums, one at a time, in a designated area of the board,
 * cycling on a timer (plan.md §6: "widgets bind to an album, and auto-fill
 * widgets re-roll their selection on a timer so a board shows fresh photos for
 * weeks untouched"). The Collage widget is the same album, several photos at
 * once; this is the single-photo case.
 */

export const galleryConfigSchema = z.object({
  // Which albums: several chosen, or all except some (../media/albums.ts).
  ...albumSelectionFields,
  /** cover fills the box (cropping); contain fits the whole photo (letterboxed). */
  fit: z.enum(["cover", "contain"]).default("cover"),
  /** Seconds each photo holds before the next. */
  intervalSeconds: z.number().min(2).max(600).default(8),
  /** Cycle in album order, or a stable shuffle. */
  order: z.enum(["album", "shuffle"]).default("album"),
  /** Show the photo's caption over the image. */
  showCaption: z.boolean().default(false),
  /** How one photo gives way to the next — the collage's effects
   *  (../collage/transitions.ts), applied to a single photo. A gallery saved
   *  before this crossfades. */
  transition: z.enum(CLEAN_TRANSITIONS).default("crossfade").catch("crossfade"),
  /** A multiplier on every duration: 2 is twice as fast, 0.5 half as fast. */
  transitionSpeed: z
    .preprocess(
      (value) => (typeof value === "number" ? Math.min(TRANSITION_SPEED_MAX, Math.max(TRANSITION_SPEED_MIN, value)) : value),
      z.number(),
    )
    .default(1)
    .catch(1),
  // Background, colour, font, padding, radius, border, shadow, header — shared
  // appearance for every widget (../style.ts).
  ...widgetStyleFields,
});

export type GalleryConfig = z.infer<typeof galleryConfigSchema>;

/** Needs its album's photos resolved into the bundle (and the editor preview) —
 *  see lib/media/album-photos.ts. Nothing to fetch until an album is picked. */
function dataNeeds(config: GalleryConfig): readonly DataNeed[] {
  return albumSelectionNeeds(readGalleryConfig(config));
}

/** Stored config -> a complete GalleryConfig. A board document stores config
 *  as a plain record, so a gallery saved before multi-album selection has no
 *  albumIds; defaults fill it and the legacy albumId is still honoured. */
export function readGalleryConfig(raw: unknown): GalleryConfig {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const parsed = galleryConfigSchema.safeParse(record);
  if (parsed.success) return parsed.data;
  const own = Object.fromEntries(Object.entries(record).filter(([key]) => !(key in widgetStyleFields)));
  const retry = galleryConfigSchema.safeParse(own);
  return retry.success ? retry.data : galleryConfigSchema.parse({ ...albumPart(record) });
}

function albumPart(record: Record<string, unknown>) {
  return typeof record.albumId === "string" ? { albumId: record.albumId } : {};
}

export const manifest: WidgetManifest<GalleryConfig> = {
  id: "gallery",
  name: "Gallery",
  description: "Photos from your albums, one at a time in a frame you place.",
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
