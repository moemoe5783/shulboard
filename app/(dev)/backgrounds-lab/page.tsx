"use client";

/*
 * The background library, all of it, at board proportions — the sheet for
 * reviewing and curating lib/board-background.ts, and what
 * scripts/test-backgrounds-browser.mjs checks is valid CSS in a real browser.
 * Each tile carries sample text in the tone the preset declares, so a preset
 * whose declared tone doesn't read is visible at a glance.
 */

import { BACKGROUND_CATEGORIES, BACKGROUND_PRESETS } from "@/lib/board-background";

export default function BackgroundsLabPage() {
  return (
    <main className="bg-paper font-ui min-h-screen p-6">
      <h1 className="text-title text-ink mb-1 font-semibold">Background library</h1>
      <p className="text-meta text-ink-soft mb-6">
        {BACKGROUND_PRESETS.length} backgrounds for boards and widget frames, drawn in CSS and SVG so they stay sharp at
        any screen size.
      </p>
      {BACKGROUND_CATEGORIES.map((category) => (
        <section key={category} className="mb-8">
          <h2 className="text-heading text-ink mb-3 font-semibold">{category}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {BACKGROUND_PRESETS.filter((preset) => preset.category === category).map((preset) => (
              <figure key={preset.id} className="flex flex-col gap-1">
                <div
                  data-preset={preset.id}
                  className="rounded-panel border-rule flex aspect-video items-center justify-center border"
                  style={{ background: preset.css, color: preset.tone === "dark" ? "var(--surface)" : "var(--ink)" }}
                >
                  <span className="text-heading font-semibold">Shabbat Shalom</span>
                </div>
                <figcaption className="text-meta text-ink-soft">{preset.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
