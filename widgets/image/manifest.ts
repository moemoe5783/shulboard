import { z } from "zod";
import type { WidgetManifest } from "../types";

export const imageConfigSchema = z.object({
  /**
   * The asset this widget shows, if it has one.
   *
   * THE ID IS WHAT THE DOCUMENT STORES; `src` is what the bundle fills in. §6:
   * widgets bind to albums and never learn where photos came from, and a URL in
   * the document would be that knowledge written down — it would also go stale
   * the moment an asset is re-processed, which changes its path by design.
   */
  assetId: z.string().max(64).default(""),
  /**
   * Resolved by the bundle builder into a media-proxy path, or set directly for
   * a board that references something outside the asset pipeline.
   *
   * Empty until somebody picks a picture, which is a state the board has to
   * survive: a half-built board goes on a wall like any other.
   */
  src: z.string().max(2048).default(""),
  alt: z.string().max(300).default(""),
  fit: z.enum(["cover", "contain"]).default("cover"),
  /**
   * Where the interesting part of the photo is, 0–1 on each axis.
   *
   * `cover` crops, and which part it throws away is the whole difference
   * between a portrait of the rov and a portrait of his shoulder. Stored in the
   * config rather than baked into the file so the same asset can be framed
   * differently in two widgets — §7 wants the same control per collage frame.
   */
  focalX: z.number().min(0).max(1).default(0.5),
  focalY: z.number().min(0).max(1).default(0.5),
  /** Design pixels. 0 is square, which is the default a board should have. */
  radius: z.number().min(0).max(200).default(0),
});

export type ImageConfig = z.infer<typeof imageConfigSchema>;

export const manifest: WidgetManifest<ImageConfig> = {
  id: "image",
  name: "Image",
  description: "One picture, cropped to fill its box.",
  category: "media",
  defaultSize: { w: 640, h: 480 },
  isPro: false,
  settingsSchema: imageConfigSchema,
  /**
   * §3c: the bundle names its assets so the service worker can cache every one
   * before the board is allowed to swap to it — and the atomic swap depends on
   * knowing WHICH assets, not just that there are some.
   *
   * Two Image widgets showing the same photograph produce the same need and are
   * fetched and cached once. A widget with nothing chosen yet needs nothing.
   */
  dataNeeds: (config) => (config.assetId ? [{ kind: "asset", assetId: config.assetId }] : []),
  /**
   * docs/sizing.md §2 doesn't mention media in either "applies to" list — an
   * image already fills its box via `fit`/`cover` cropping (the config field
   * above, a different and older use of the word "fit"), so there's no font
   * size for a sizing mode to drive either way. Declared `fit` for manifest
   * completeness — every widget must state one — but it's a no-op here, not
   * a real choice. Not toggleable, since there's nothing for the other mode
   * to mean for a picture.
   */
  sizing: { mode: "fit", userToggleable: false },
  instanceLabel: (config) => config.alt || "Image",
};
