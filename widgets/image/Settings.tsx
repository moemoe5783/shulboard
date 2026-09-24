"use client";

import { useState } from "react";
import { SliderField } from "@/components/editor/SliderField";
import { PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import type { AppearanceSection, WidgetSettingsProps } from "@/widgets/types";
import { MediaPicker } from "../media/MediaPicker";
import type { ImageConfig } from "./manifest";

/*
 * The Image widget's panel. The picture comes from the shul's own Media — an
 * album photo, or one uploaded right here into an album — never a pasted web
 * link: the document stores the asset id, the bundle turns it into a cached
 * media-proxy path (lib/bundle/assemble.ts), and so the picture keeps showing
 * offline and survives the file being re-processed. `src` is also set here so
 * the editor preview shows the choice immediately; the bundle overwrites it
 * from the asset id when the board is published.
 */

export function Settings({ config, onChange }: WidgetSettingsProps<ImageConfig>) {
  const [browsing, setBrowsing] = useState(!config.src);
  const legacyLink = config.src !== "" && config.assetId === "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className={PANEL_LABEL}>Picture</span>
        {config.src ? (
          <div className="border-paper/15 flex items-center gap-3 rounded-[5px] border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a media-proxy path. */}
            <img src={config.src} alt="" className="size-14 rounded-[5px] object-cover" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-cell text-paper truncate">{config.alt || "Chosen picture"}</span>
              <button
                type="button"
                className="text-meta text-paper/70 hover:text-paper self-start underline"
                onClick={() => setBrowsing(!browsing)}
              >
                {browsing ? "Close Media" : "Change picture"}
              </button>
            </div>
          </div>
        ) : (
          <span className={PANEL_LABEL}>Choose a photo from Media, or upload one.</span>
        )}
        {legacyLink && (
          <span className="text-meta text-stale">
            This picture is a web link, so it won&rsquo;t show when a screen is offline. Choose it from Media instead.
          </span>
        )}
      </div>

      {browsing && (
        <MediaPicker
          selectedAssetId={config.assetId}
          onPick={(photo) => {
            onChange({ assetId: photo.assetId, src: photo.src, alt: config.alt || photo.caption || "" });
            setBrowsing(false);
          }}
        />
      )}

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Description (read aloud by screen readers)</span>
        <input
          type="text"
          value={config.alt}
          maxLength={300}
          onChange={(event) => onChange({ alt: event.target.value })}
          className={PANEL_CONTROL}
        />
      </label>
    </div>
  );
}

/** How the picture sits in its box — the Appearance tab's Photo section. */
function ImageLook({ config, onChange }: WidgetSettingsProps<ImageConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Fit</span>
        <select
          value={config.fit}
          onChange={(event) => onChange({ fit: event.target.value as ImageConfig["fit"] })}
          className={PANEL_CONTROL}
        >
          <option value="cover">Fill the box (crops the edges)</option>
          <option value="contain">Show the whole picture</option>
        </select>
      </label>

      <SliderField
        label="Rounded corners"
        hint="How round the picture's corners are."
        value={config.radius}
        onChange={(radius) => onChange({ radius })}
        min={0}
        max={200}
      />
    </div>
  );
}

export const appearance: AppearanceSection<ImageConfig>[] = [{ id: "photo", label: "Photo", Component: ImageLook }];
