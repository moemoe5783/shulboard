import { z } from "zod";
import { albumSelectionFields, albumSelectionNeeds } from "../media/albums";
import { widgetStyleFields } from "../style";
import { COLLAGE_TRANSITIONS } from "./transitions";
import type { DataNeed, WidgetManifest } from "../types";

/*
 * Collage — photos from one album, arranged by their own shapes (lib/collage).
 *
 * THE PHOTOS DESIGN THE LAYOUT. Nothing is cropped or stretched: the engine
 * builds a slicing tree from the photos' aspect ratios, sizes it exactly into
 * the box with uniform gaps, and leaves whatever it can't fill as the leftover
 * colour. When the album holds more than fit at a readable size, it pages
 * through them, a new arrangement per page, every photo once per cycle.
 *
 * Every field `.catch()`es to its default, because a board document stores
 * config as a plain record (lib/board-doc.ts doesn't re-validate it) and a
 * collage saved by an earlier version of this widget — `count`, an interval
 * of 0 — must still render rather than throw. `readCollageConfig` is the one
 * place that turns stored config into this shape.
 */

export const collageConfigSchema = z.object({
  // Which albums: several chosen, or all except some (../media/albums.ts).
  ...albumSelectionFields,
  /** Space between photos, in board design units. Kept as `gutter` so collages
   *  saved before the spec's "gap" wording keep their value. */
  gutter: z.number().min(0).max(60).default(8).catch(8),
  /** Corner radius on each photo, in board design units. */
  photoRadius: z.number().min(0).max(80).default(6).catch(6),
  /**
   * LEGACY — an inner background from before the collage used the widget's
   * own Appearance background. There is ONE background now: the frame's,
   * which shows through the gaps and any space the photos don't fill. A
   * collage saved with this set still renders it, and its Settings offer to
   * move it to Appearance (widgets/collage/Settings.tsx); nothing new writes it.
   */
  leftoverColor: z.string().max(64).default("").catch(""),
  /** How many photos per page: auto (as many as stay readable), a range, or exact. */
  density: z.enum(["auto", "few", "medium", "many", "exact"]).default("auto").catch("auto"),
  /** The count for `exact` density. */
  exactCount: z.number().int().min(1).max(14).default(6).catch(6),
  order: z.enum(["newest", "album", "shuffle"]).default("newest").catch("newest"),
  /** Seconds each page holds. Clamped rather than refused, so an old collage's
   *  interval (0 meant "never" there) lands on the nearest allowed value. */
  intervalSeconds: z
    .preprocess((value) => (typeof value === "number" ? Math.min(120, Math.max(3, value)) : value), z.number())
    .default(10)
    .catch(10),
  /** How pages change — one by one (four styles), the whole page at once, or
   *  instantly (./transitions.ts). */
  transition: z.enum(COLLAGE_TRANSITIONS).default("cascade").catch("cascade"),
  /** An optional thin border or soft shadow on each photo. */
  photoFrame: z.enum(["none", "border", "shadow"]).default("none").catch("none"),
  // Background, colour, font, padding, border, shadow, header — shared
  // appearance for every widget (../style.ts). The widget frame's radius is
  // separate from `photoRadius`, which rounds the individual photos.
  ...widgetStyleFields,
});

export type CollageConfig = z.infer<typeof collageConfigSchema>;

/** Stored config -> a complete, valid CollageConfig. Never throws. */
export function readCollageConfig(raw: unknown): CollageConfig {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const parsed = collageConfigSchema.safeParse(record);
  if (parsed.success) return parsed.data;
  // Only a shared appearance field can fail (every collage field catches), so
  // keep the collage's own settings and let the appearance fall to defaults —
  // the frame reads its own fields through normalizeWidgetStyle regardless.
  const own = Object.fromEntries(Object.entries(record).filter(([key]) => !(key in widgetStyleFields)));
  return collageConfigSchema.parse(own);
}

function dataNeeds(config: CollageConfig): readonly DataNeed[] {
  return albumSelectionNeeds(config);
}

export const manifest: WidgetManifest<CollageConfig> = {
  id: "collage",
  name: "Collage",
  description: "Photos from your albums, arranged to fit their own shapes — nothing cropped.",
  category: "media",
  defaultSize: { w: 960, h: 540 },
  isPro: false,
  settingsSchema: collageConfigSchema,
  dataNeeds,
  sizing: { mode: "fit", userToggleable: false },
  instanceLabel: () => "Collage",
};
