"use client";

import { NumberField } from "@/components/editor/NumberField";
import type { WidgetSettingsProps } from "@/widgets/types";
import { AlbumField } from "../media/AlbumField";
import type { CollageConfig } from "./manifest";

export function Settings({ config, onChange }: WidgetSettingsProps<CollageConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <AlbumField value={config.albumId} onChange={(albumId) => onChange({ albumId })} />

      <NumberField
        label="Photos at once"
        value={config.count}
        onChange={(count) => onChange({ count })}
        min={1}
        max={6}
        hint="Up to six — the layout is chosen to fit their shapes."
      />

      <NumberField
        label="Re-roll seconds"
        value={config.intervalSeconds}
        onChange={(intervalSeconds) => onChange({ intervalSeconds })}
        min={0}
        max={3600}
        hint="How often to swap in a fresh set. 0 keeps the same photos."
      />

      <NumberField label="Gutter" value={config.gutter} onChange={(gutter) => onChange({ gutter })} min={0} max={60} />

      <NumberField
        label="Photo corner radius"
        value={config.photoRadius}
        onChange={(photoRadius) => onChange({ photoRadius })}
        min={0}
        max={80}
      />
    </div>
  );
}
