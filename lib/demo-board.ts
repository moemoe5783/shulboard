import { parseBoardDoc, type BoardDoc } from "@/lib/board-doc";

/*
 * One hardcoded board, rendered by both halves of the app.
 *
 * The editor lab seeds from it and /s/[token] serves it, so the shared-renderer
 * rule is not a claim in a comment — the same document goes through the same
 * component in both places, and a divergence shows up as the two looking
 * different rather than as a bug report from a shul.
 *
 * Ids are literals rather than crypto.randomUUID(). The display route renders on
 * the server and hydrates in the browser, and a document whose ids were minted
 * per process would be a different document in each.
 */

export const DEMO_CANVAS = { width: 1920, height: 1080 };

/**
 * Crown Heights, Brooklyn — plan.md §5c's own recurring example ("twenty
 * Crown Heights shuls share the same rows"), so a demo page using this
 * matches the numbers a reviewer reading that section would expect. Real
 * coordinates, not a rounded placeholder: candle lighting and Havdalah are
 * genuinely sensitive to a few hundredths of a degree near a shul's actual
 * corner.
 */
export const DEMO_LOCATION = {
  latitude: 40.6694,
  longitude: -73.9422,
  timeZone: "America/New_York",
};

export function demoBoardDoc(): BoardDoc {
  // Through parseBoardDoc like every other document. Percentages are checked
  // here, so a pixel value typed into this file fails loudly instead of
  // shipping to a wall three canvases off to the right.
  return parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { font: "assistant", ink: "ink", background: "surface" },
    widgets: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        type: "title",
        x: 4.1667, // 80 design units
        y: 7.4074, // 80
        w: 52.0833, // 1000
        h: 14.8148, // 160
        z: 0,
        config: {
          text: "Beis Menachem",
          subtitle: "Kiddush this Shabbos after davening",
          align: "left",
          size: 96,
        },
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        type: "clock",
        x: 60.4167, // 1160
        y: 7.4074,
        w: 35.4167, // 680
        h: 14.8148,
        z: 1,
        config: { hour12: true, showSeconds: true, align: "right", size: 128 },
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        type: "image",
        x: 4.1667,
        y: 27.7778, // 300
        w: 43.75, // 840
        h: 62.963, // 680
        z: 2,
        config: {
          src: "/demo/test-card.svg",
          alt: "Test card showing which part of a picture survives the crop",
          fit: "cover",
          focalX: 0.5,
          focalY: 0.2,
          radius: 12,
        },
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        type: "title",
        x: 52.0833, // 1000
        y: 27.7778,
        w: 43.75,
        h: 25.9259, // 280
        z: 3,
        config: {
          text: "Shacharis 7:00",
          subtitle: "Mincha 1:45, Maariv 8:30",
          align: "left",
          size: 72,
        },
      },
    ],
  });
}
