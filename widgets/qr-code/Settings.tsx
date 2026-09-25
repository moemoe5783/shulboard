"use client";

import { ColorField } from "@/components/editor/ColorField";
import { PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import { SliderField } from "@/components/editor/SliderField";
import { readConfig } from "@/widgets/read-config";
import type { AppearanceSection, WidgetSettingsProps } from "@/widgets/types";
import { qrCodeConfigSchema, type QrCodeConfig } from "./manifest";

function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((part) => {
    const c = parseInt(part, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Why a phone might not read these colours, or null if they're fine. Many
 *  phone cameras can't read a light-on-dark (inverted) code at all, and every
 *  one struggles below about 3:1 contrast. */
function colourProblem(dark: string, light: string): string | null {
  const d = luminance(dark);
  const l = luminance(light);
  if (d === null || l === null) return null;
  if (d > l) return "The squares are lighter than the background. Many phones can't read a code like that — swap the colours.";
  if ((l + 0.05) / (d + 0.05) < 3) return "These two colours are too close for some phones to read. Make the squares darker or the background lighter.";
  return null;
}

export function Settings({ config: raw, onChange }: WidgetSettingsProps<QrCodeConfig>) {
  const config = readConfig(qrCodeConfigSchema, raw);
  const value = config.value.trim();
  // "shul.org/donate" with no https:// is a web address some phones treat as
  // plain text.
  const bareAddress = !/^[a-z][a-z0-9+.-]*:/i.test(value) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Link</span>
        <input
          type="text"
          inputMode="url"
          value={config.value}
          maxLength={1200}
          placeholder="https://"
          spellCheck={false}
          onChange={(event) => onChange({ value: event.target.value })}
          className={PANEL_CONTROL}
        />
        {bareAddress && (
          <span className="text-meta text-stale">
            Add https:// at the start, or some phones will show this as text instead of opening it.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Caption</span>
        <input
          type="text"
          value={config.caption}
          maxLength={120}
          placeholder="Scan to donate"
          onChange={(event) => onChange({ caption: event.target.value })}
          className={PANEL_CONTROL}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Error correction</span>
        <select
          value={config.errorCorrection}
          onChange={(event) => onChange({ errorCorrection: event.target.value as QrCodeConfig["errorCorrection"] })}
          className={PANEL_CONTROL}
        >
          <option value="L">Low — simplest code</option>
          <option value="M">Medium — recommended</option>
          <option value="Q">High</option>
          <option value="H">Highest — densest code</option>
        </select>
      </label>
    </div>
  );
}

/** The caption's size, at the top of the Appearance tab's Text section with
 *  the rest of the text settings. */
function QrCaptionText({ config: raw, onChange }: WidgetSettingsProps<QrCodeConfig>) {
  const config = readConfig(qrCodeConfigSchema, raw);
  if (!config.caption) return null;
  return (
    <SliderField
      label="Caption size"
      value={config.captionSize}
      min={8}
      max={200}
      onChange={(captionSize) => onChange({ captionSize })}
    />
  );
}

/** The code's colours and margin — the Appearance tab's Code section. */
function QrCodeLook({ config: raw, onChange }: WidgetSettingsProps<QrCodeConfig>) {
  const config = readConfig(qrCodeConfigSchema, raw);
  const problem = colourProblem(config.darkColor, config.lightColor);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className={PANEL_LABEL}>Colours</span>
        <div className="flex items-center gap-2">
          <ColorField label="Squares" value={config.darkColor} onChange={(darkColor) => onChange({ darkColor })} />
          <ColorField label="Background" value={config.lightColor} onChange={(lightColor) => onChange({ lightColor })} />
        </div>
        {problem && <span className="text-meta text-stale">{problem}</span>}
      </div>

      <SliderField label="Margin" value={config.margin} min={0} max={8} onChange={(margin) => onChange({ margin })} unit="squares" />
    </div>
  );
}

export const appearance: AppearanceSection<QrCodeConfig>[] = [
  { id: "code", label: "Code", Component: QrCodeLook },
  { id: "text", label: "Text", Component: QrCaptionText },
];
