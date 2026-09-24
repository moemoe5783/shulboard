"use client";

/*
 * The Gallery, QR code and Text widgets through the real BoardRenderer — what
 * scripts/test-widgets-browser.mjs drives. The gallery's album is synthetic
 * (SVG photos as data URLs, no network or Storage), and its transition and
 * speed come from the query string:
 *
 *   ?transition=slide&speed=1&interval=2
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BoardRenderer } from "@/components/board/BoardRenderer";
import { parseBoardDoc } from "@/lib/board-doc";
import type { BoardAlbums, BoardPhoto } from "@/lib/media/album-photos";

const CANVAS = { width: 1920, height: 1080 };
const BOARD_PX = { width: 1280, height: 720 };
const GALLERY_ID = "77777777-7777-4777-8777-777777777771";
const QR_ID = "77777777-7777-4777-8777-777777777772";
const TEXT_FIXED_ID = "77777777-7777-4777-8777-777777777773";
const TEXT_FIT_ID = "77777777-7777-4777-8777-777777777774";
const TEXT_HUG_ID = "77777777-7777-4777-8777-777777777775";
const QR_LINK = "https://example.org/donate?campaign=lobby-screen";

function svgPhoto(hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">` +
    `<rect width="100%" height="100%" fill="hsl(${hue} 45% 45%)"/>` +
    `<circle cx="400" cy="300" r="150" fill="hsl(${hue} 45% 75%)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const PHOTOS: BoardPhoto[] = [0, 120, 240].map((hue, i) => {
  const src = svgPhoto(hue);
  return {
    assetId: `gallery-${i}`,
    src,
    width: 800,
    height: 600,
    caption: null,
    addedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    displayUntil: null,
    variants: [{ name: "display", src, width: 800, height: 600, contentType: "image/svg+xml", bytes: src.length }],
  };
});
const ALBUMS: BoardAlbums = { "lab-album": PHOTOS };

const HEBREW = "שבת שלום";

function WidgetsLabInner() {
  const params = useSearchParams();
  const doc = parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { font: "assistant", ink: "ink", background: "surface" },
    widgets: [
      {
        id: GALLERY_ID,
        type: "gallery",
        x: 2,
        y: 2,
        w: 30,
        h: 40,
        z: 0,
        config: {
          albumIds: ["lab-album"],
          intervalSeconds: Number(params.get("interval") ?? 2),
          transition: params.get("transition") ?? "crossfade",
          transitionSpeed: Number(params.get("speed") ?? 1),
        },
      },
      { id: QR_ID, type: "qr-code", x: 36, y: 2, w: 20, h: 45, z: 0, config: { value: QR_LINK, caption: "Scan to donate" } },
      {
        id: TEXT_FIXED_ID,
        type: "text",
        x: 60,
        y: 2,
        w: 38,
        h: 30,
        z: 0,
        config: { text: `A notice that runs long enough to wrap onto more than one line in its box.\n${HEBREW}`, size: 40 },
      },
      {
        id: TEXT_FIT_ID,
        type: "text",
        x: 2,
        y: 50,
        w: 40,
        h: 30,
        z: 0,
        config: { text: "Kiddush this Shabbos is sponsored by the Levi family.", sizingMode: "fit" },
      },
      {
        id: TEXT_HUG_ID,
        type: "text",
        x: 50,
        y: 50,
        w: 30,
        h: 5,
        z: 0,
        config: { text: "One line.\nA second.\nAnd a third.", sizingMode: "hug", size: 40 },
      },
    ],
  });
  return (
    <div className="p-4">
      <div data-widgets-lab style={{ position: "relative", ...BOARD_PX }}>
        <BoardRenderer
          doc={doc}
          canvas={CANVAS}
          albums={ALBUMS}
          style={BOARD_PX}
          widgetProps={(widget) => ({ "data-widget-id": widget.id })}
        />
      </div>
    </div>
  );
}

export default function WidgetsLabPage() {
  return (
    <Suspense fallback={null}>
      <WidgetsLabInner />
    </Suspense>
  );
}
