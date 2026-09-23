"use client";

/*
 * The REAL board editor holding a Collage and a Gallery saved before
 * multi-album selection existed — config with a single `albumId` and no
 * `albumIds`, exactly as older board documents store it. The editor reads
 * every widget's dataNeeds from that stored config, and one such collage used
 * to crash the whole editor ("This page didn't load"). Driven by
 * scripts/test-collage-widget.mjs.
 */
import { BoardEditor } from "@/app/(editor)/boards/[id]/BoardEditor";
import { boardDocAsJson, parseBoardDoc } from "@/lib/board-doc";
import { DEMO_LOCATION } from "@/lib/demo-board";
const doc = parseBoardDoc({
  schemaVersion: 1,
  themeOverrides: { font: "assistant", ink: "ink", background: "surface" },
  widgets: [
    { id: "77777777-7777-4777-8777-777777777777", type: "collage", x: 5, y: 5, w: 40, h: 40, z: 0, config: { albumId: "00000000-0000-4000-8000-00000000000a", count: 4, intervalSeconds: 20, gutter: 8, photoRadius: 6 } },
    { id: "88888888-8888-4888-8888-888888888888", type: "gallery", x: 50, y: 5, w: 40, h: 40, z: 1, config: { albumId: "00000000-0000-4000-8000-00000000000a", fit: "cover", intervalSeconds: 8, order: "album", showCaption: false } },
  ],
});
export default function Page() {
  return (
    <div style={{ height: "100vh" }}>
      <BoardEditor boardId="00000000-0000-4000-8000-000000000000" name="Legacy" canvas={{ width: 1920, height: 1080 }} doc={boardDocAsJson(doc)} location={DEMO_LOCATION} publishState={{ publishedAt: null, screenCount: 0, pendingChanges: true }} />
    </div>
  );
}
