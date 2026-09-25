"use client";

import { useState } from "react";
import { BACKGROUND_LIBRARY } from "@/lib/background-library";
import {
  backgroundAssetId,
  backgroundCss,
  backgroundKind,
  backgroundTone,
  boardBackgroundCss,
  clampDim,
  DEFAULT_GRADIENT,
  gradientCss,
  libraryBackground,
  MAX_BACKGROUND_DIM,
  parseGradient,
  toneForLuminance,
  type BackgroundTone,
  type BoardBackground,
  type GradientSpec,
} from "@/lib/board-background";
import type { BoardPhoto } from "@/lib/media/album-photos";
import { MediaPicker } from "@/widgets/media/MediaPicker";
import { ColorField, ColorPicker } from "./ColorField";
import { PANEL_CONTROL, PANEL_LABEL } from "./panelControls";
import { SliderField } from "./SliderField";

/*
 * Backgrounds in the editor (lib/board-background.ts).
 *
 * `BackgroundField` is a widget box's: a colour or a gradient. Its ready-made
 * looks are the frame presets on the Appearance tab (widgets/style.ts), not
 * pictures.
 *
 * `BoardBackgroundField` is the board's: a colour, a gradient, or a picture —
 * one from the library that ships with the product, or any photo in the shul's
 * Media — with a darkening veil so text on a busy photo stays readable.
 *
 * Both report the new background's tone, so the caller can keep text readable
 * (the board panel switches the board's text to light on a dark background).
 */

type Tab = "color" | "gradient" | "picture";

const DEFAULT_COLOR = "#1b2a2e";
const CHECKERBOARD = "repeating-conic-gradient(var(--ink-faint) 0 25%, transparent 0 50%) 0 0 / 12px 12px";

export function BackgroundField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string, tone: BackgroundTone | null) => void;
}) {
  const kind = backgroundKind(value);
  const [tab, setTab] = useState<Tab>(kind === "gradient" ? "gradient" : "color");
  const set = (next: string) => onChange(next, backgroundTone(next));

  return (
    <div className="flex flex-col gap-2" data-background-field>
      <Summary preview={backgroundCss(value)} text={describe(value)} onClear={kind !== "none" ? () => set("") : undefined} />
      <Tabs tabs={[["color", "Colour"], ["gradient", "Gradient"]]} tab={tab} onTab={setTab} />
      {tab === "color" && (
        <ColorPicker label="Background colour" value={kind === "color" ? value : DEFAULT_COLOR} onChange={set} />
      )}
      {tab === "gradient" && <GradientEditor value={value} onChange={set} />}
    </div>
  );
}

export function BoardBackgroundField({
  value: background,
  onChange,
}: {
  value: BoardBackground;
  onChange: (next: BoardBackground, tone: BackgroundTone | null) => void;
}) {
  const value = background.value ?? "";
  const kind = backgroundKind(value);
  const [tab, setTab] = useState<Tab>(kind === "gradient" ? "gradient" : kind === "image" ? "picture" : "color");
  const setPlain = (next: string) => onChange({ value: next }, backgroundTone(next));
  const dim = clampDim(background.dim);

  const pickLibrary = (id: string) => {
    const entry = libraryBackground(`library:${id}`);
    if (!entry) return;
    onChange({ value: `library:${id}`, dim, luminance: entry.luminance }, toneForLuminance(entry.luminance, dim));
  };
  const pickPhoto = (photo: BoardPhoto) => {
    // The largest stored size: a background fills the whole screen.
    const src = photo.variants.length > 0 ? photo.variants[photo.variants.length - 1].src : photo.src;
    const thumb = photo.variants[0]?.src ?? photo.src;
    const next: BoardBackground = { value: `image:${photo.assetId}`, src, dim };
    onChange(next, null);
    // Measure the photo's brightness from its thumbnail, then report the tone.
    void measureLuminance(thumb).then((luminance) => {
      if (luminance !== null) onChange({ ...next, luminance }, toneForLuminance(luminance, dim));
    });
  };
  const setDim = (nextDim: number) => {
    const luminance = typeof background.luminance === "number" ? background.luminance : null;
    onChange({ ...background, dim: nextDim }, luminance === null ? null : toneForLuminance(luminance, nextDim));
  };

  return (
    <div className="flex flex-col gap-2" data-background-field>
      <Summary
        preview={boardBackgroundCss(background)}
        text={describe(value)}
        onClear={kind !== "none" ? () => setPlain("") : undefined}
      />
      <Tabs
        tabs={[
          ["color", "Colour"],
          ["gradient", "Gradient"],
          ["picture", "Picture"],
        ]}
        tab={tab}
        onTab={setTab}
      />
      {tab === "color" && (
        <ColorPicker label="Background colour" value={kind === "color" ? value : DEFAULT_COLOR} onChange={setPlain} />
      )}
      {tab === "gradient" && <GradientEditor value={value} onChange={setPlain} />}
      {tab === "picture" && (
        <div className="flex flex-col gap-3">
          {kind === "image" && (
            <SliderField
              label="Darken"
              value={dim}
              min={0}
              max={MAX_BACKGROUND_DIM}
              step={5}
              onChange={setDim}
              unit="%"
            />
          )}
          <Library value={value} onPick={pickLibrary} />
          <div className="flex flex-col gap-1.5">
            <span className={PANEL_LABEL}>From your Media</span>
            <MediaPicker selectedAssetId={backgroundAssetId(value) ?? ""} onPick={pickPhoto} />
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ preview, text, onClear }: { preview: string | undefined; text: string; onClear?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="border-paper/25 h-9 w-14 shrink-0 rounded-[5px] border"
        style={{ background: preview ?? CHECKERBOARD }}
        aria-hidden
      />
      <span className="text-meta text-paper/70 min-w-0 flex-1 truncate">{text}</span>
      {onClear && (
        <button type="button" className="text-meta text-paper/60 hover:text-paper underline" onClick={onClear}>
          None
        </button>
      )}
    </div>
  );
}

function Tabs({ tabs, tab, onTab }: { tabs: [Tab, string][]; tab: Tab; onTab: (tab: Tab) => void }) {
  return (
    <div className="flex gap-1" role="tablist">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onTab(id)}
          className={`text-meta flex-1 rounded-[5px] px-2 py-1 ${tab === id ? "bg-paper/15 text-paper" : "text-paper/60 hover:text-paper"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function describe(value: string): string {
  switch (backgroundKind(value)) {
    case "none":
      return "None — the board shows through";
    case "color":
      return value;
    case "gradient":
      return "Gradient";
    case "image":
      return libraryBackground(value)?.name ?? (backgroundAssetId(value) ? "Photo from Media" : "Picture");
  }
}

/** Average relative luminance of an image, 0–1, from a small same-origin copy.
 *  Null if it can't be read (still loading, cross-origin, no canvas). */
function measureLuminance(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        context.drawImage(img, 0, 0, size, size);
        const { data } = context.getImageData(0, 0, size, size);
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b] = [data[i], data[i + 1], data[i + 2]].map((v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        resolve(total / (data.length / 4));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function GradientEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const spec: GradientSpec = parseGradient(value) ?? DEFAULT_GRADIENT;
  const update = (patch: Partial<GradientSpec>) => onChange(gradientCss({ ...spec, ...patch }));
  const setStop = (index: number, color: string) =>
    update({ stops: spec.stops.map((stop, i) => (i === index ? { ...stop, color } : stop)) });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Shape</span>
        <select
          value={spec.type}
          onChange={(event) => update({ type: event.target.value as GradientSpec["type"] })}
          className={PANEL_CONTROL}
        >
          <option value="linear">Straight</option>
          <option value="radial">Glow from the centre</option>
        </select>
      </label>
      {spec.type === "linear" && (
        <SliderField label="Direction" value={spec.angle} min={0} max={359} onChange={(angle) => update({ angle })} unit="°" />
      )}
      <div className="flex flex-col gap-2">
        <span className={PANEL_LABEL}>Colours</span>
        {spec.stops.map((stop, index) => (
          <div key={index} className="flex items-center gap-2">
            <ColorField label={`Gradient colour ${index + 1}`} value={stop.color} onChange={(color) => setStop(index, color)} />
            {spec.stops.length > 2 && (
              <button
                type="button"
                className="text-meta text-paper/60 hover:text-paper underline"
                onClick={() => update({ stops: spreadStops(spec.stops.filter((_, i) => i !== index)) })}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {spec.stops.length < 4 && (
          <button
            type="button"
            className="text-meta text-paper/70 hover:text-paper self-start underline"
            onClick={() => update({ stops: spreadStops([...spec.stops, { color: spec.stops[spec.stops.length - 1].color, at: 100 }]) })}
          >
            Add a colour
          </button>
        )}
      </div>
    </div>
  );
}

/** Space stops evenly from 0% to 100%. */
function spreadStops(stops: GradientSpec["stops"]): GradientSpec["stops"] {
  return stops.map((stop, i) => ({ ...stop, at: stops.length === 1 ? 0 : (i / (stops.length - 1)) * 100 }));
}

function Library({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  if (BACKGROUND_LIBRARY.length === 0) {
    return <span className={PANEL_LABEL}>The background library is empty for now. Use a photo from your Media below.</span>;
  }
  const categories = [...new Set(BACKGROUND_LIBRARY.map((entry) => entry.category))];
  return (
    <div className="flex max-h-96 flex-col gap-3 overflow-auto pr-1" data-background-library>
      {categories.map((category) => (
        <div key={category} className="flex flex-col gap-1.5">
          <span className={PANEL_LABEL}>{category}</span>
          <div className="grid grid-cols-3 gap-1.5">
            {BACKGROUND_LIBRARY.filter((entry) => entry.category === category).map((entry) => {
              const chosen = value === `library:${entry.id}`;
              return (
                <button
                  key={entry.id}
                  type="button"
                  title={entry.name}
                  aria-label={entry.name}
                  aria-pressed={chosen}
                  onClick={() => onPick(entry.id)}
                  className={`aspect-video w-full overflow-hidden rounded-[5px] border-2 ${chosen ? "border-verdigris" : "hover:border-paper/40 border-transparent"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a static library thumbnail. */}
                  <img src={entry.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
