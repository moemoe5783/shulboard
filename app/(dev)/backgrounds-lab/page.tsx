"use client";

/*
 * Board backgrounds, rendered for real — the sheet for reviewing the picture
 * library (lib/background-library.ts, filled by scripts/add-backgrounds.mjs)
 * and what scripts/test-backgrounds-browser.mjs checks in a real browser: that a
 * picture background draws on the board through the same BoardRenderer a
 * screen uses, that the darkening veil sits over it, and that a picture value
 * on a widget's box draws nothing (pictures are for the board).
 */

import { BoardRenderer } from "@/components/board/BoardRenderer";
import { BACKGROUND_LIBRARY } from "@/lib/background-library";
import type { BoardBackground } from "@/lib/board-background";
import { parseBoardDoc } from "@/lib/board-doc";

const CANVAS = { width: 1920, height: 1080 };
const BOARD_PX = { width: 480, height: 270 };
const SAMPLE_PHOTO = "/demo/test-card.svg";

function sampleDoc(background: BoardBackground, widgetBackground = "", frame: Record<string, unknown> = {}) {
  return parseBoardDoc({
    schemaVersion: 1,
    background,
    themeOverrides: { font: "assistant", ink: "surface" },
    widgets: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        type: "title",
        x: 10,
        y: 35,
        w: 80,
        h: 30,
        z: 0,
        config: { text: "Shabbat shalom", background: widgetBackground, ...frame },
      },
    ],
  });
}

function Sample({
  id,
  label,
  background,
  widgetBackground,
  frame,
}: {
  id: string;
  label: string;
  background: BoardBackground;
  widgetBackground?: string;
  frame?: Record<string, unknown>;
}) {
  return (
    <figure className="flex flex-col gap-1">
      <div data-sample={id} style={BOARD_PX}>
        <BoardRenderer
          doc={sampleDoc(background, widgetBackground, frame)}
          canvas={CANVAS}
          style={BOARD_PX}
          widgetProps={(widget) => ({ "data-widget-id": widget.id })}
        />
      </div>
      <figcaption className="text-meta text-ink-soft">{label}</figcaption>
    </figure>
  );
}

export default function BackgroundsLabPage() {
  return (
    <main className="bg-paper font-ui min-h-screen p-6">
      <h1 className="text-title text-ink mb-1 font-semibold">Board backgrounds</h1>
      <p className="text-meta text-ink-soft mb-6">
        {BACKGROUND_LIBRARY.length === 0
          ? "The picture library is empty. Add pictures with npm run backgrounds."
          : `${BACKGROUND_LIBRARY.length} pictures in the library.`}
      </p>

      <section className="mb-8">
        <h2 className="text-heading text-ink mb-3 font-semibold">A photo from Media</h2>
        <div className="flex flex-wrap gap-4">
          <Sample id="photo" label="As picked" background={{ value: "image:sample", src: SAMPLE_PHOTO }} />
          <Sample id="photo-dim" label="Darkened 40%" background={{ value: "image:sample", src: SAMPLE_PHOTO, dim: 40 }} />
          <Sample
            id="widget-picture"
            label="A picture value on a widget draws nothing"
            background={{ value: "#12314a" }}
            widgetBackground="image:sample"
          />
          <Sample
            id="widget-gradient"
            label="A gradient on a widget does draw"
            background={{ value: "#12314a" }}
            widgetBackground="linear-gradient(90deg, #d4af37 0%, #8a6d1f 100%)"
          />
          <Sample id="legacy-preset" label="A removed drawn preset" background={{ value: "preset:midnight" }} />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-heading text-ink mb-3 font-semibold">Widget frames</h2>
        <div className="flex flex-wrap gap-4">
          <Sample
            id="rounded-shadow"
            label="Rounded corners with a shadow"
            background={{ value: "#e8e4dc" }}
            widgetBackground="#ffffff"
            frame={{ radius: 120, shadow: true }}
          />
        </div>
      </section>

      {BACKGROUND_LIBRARY.length > 0 && (
        <section className="mb-8">
          <h2 className="text-heading text-ink mb-3 font-semibold">Library</h2>
          <div className="flex flex-wrap gap-4">
            {BACKGROUND_LIBRARY.map((entry) => (
              <Sample
                key={entry.id}
                id={`library-${entry.id}`}
                label={`${entry.name} (${entry.category})`}
                background={{ value: `library:${entry.id}` }}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
