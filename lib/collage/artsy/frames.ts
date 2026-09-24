/*
 * The Artsy collage's frame styles — spec §4 — as numbers.
 *
 * Every size is a fraction of the photo's SHORT side, so a frame looks the
 * same weight on a thumbnail as on a hero. Two kinds of margin:
 *
 *  - `paper`: what's drawn around the photo — the Polaroid's paper, a print's
 *    white border, a wood frame and its mat.
 *  - `reach`: transparent room outside the paper for what sticks out of it —
 *    the half of a tape strip above a snapshot, a pin head. It is part of the
 *    item's outer rect, so the layout keeps it off every other photo exactly as
 *    it keeps the paper off, and a fastener can never land on anyone's image.
 *
 * The outer rect is the photo plus both. Starting values, tuned in the lab.
 */

export const FRAME_STYLES = ["polaroid", "classic", "wood", "gallery", "taped", "pinned", "mixed"] as const;
export type FrameStyle = (typeof FRAME_STYLES)[number];
/** A style an individual item can wear — "mixed" picks one of these per item. */
export type ItemFrameStyle = Exclude<FrameStyle, "mixed">;

export const FRAME_LABELS: Record<FrameStyle, string> = {
  polaroid: "Polaroid",
  classic: "Classic print",
  wood: "Wood frame",
  gallery: "Gallery frame",
  taped: "Taped snapshot",
  pinned: "Pinned print",
  mixed: "Mixed prints",
};

export type Insets = { t: number; r: number; b: number; l: number };

export type FrameSpec = {
  style: ItemFrameStyle;
  paper: Insets;
  reach: Insets;
  /** For wood and gallery: how much of `paper` is the frame; the rest is mat. */
  frame: number;
  fastener: "none" | "tape" | "pin";
};

const all = (v: number): Insets => ({ t: v, r: v, b: v, l: v });
const NONE: Insets = all(0);

/** "Mixed" draws from paper prints only — a wood frame beside a Polaroid reads
 *  as two different walls (spec §4). */
export const MIXED_SET: readonly ItemFrameStyle[] = ["polaroid", "classic", "taped", "pinned"];

/** The frame for one item. `fasteners` off drops the tape or pin and the room
 *  kept for it. */
export function frameSpec(style: ItemFrameStyle, fasteners: boolean): FrameSpec {
  switch (style) {
    case "polaroid":
      return { style, paper: { t: 0.05, r: 0.05, b: 0.2, l: 0.05 }, reach: NONE, frame: 0, fastener: "none" };
    case "classic":
      return { style, paper: all(0.04), reach: NONE, frame: 0, fastener: "none" };
    case "wood":
      // 7% frame + 6% mat.
      return { style, paper: all(0.13), reach: NONE, frame: 0.07, fastener: "none" };
    case "gallery":
      // 3% frame + 10% mat.
      return { style, paper: all(0.13), reach: NONE, frame: 0.03, fastener: "none" };
    case "taped":
      return fasteners
        ? { style, paper: all(0.03), reach: { t: 0.045, r: 0, b: 0, l: 0 }, frame: 0, fastener: "tape" }
        : { style, paper: all(0.03), reach: NONE, frame: 0, fastener: "none" };
    case "pinned":
      return fasteners
        ? { style, paper: { t: 0.07, r: 0.04, b: 0.04, l: 0.04 }, reach: { t: 0.015, r: 0, b: 0, l: 0 }, frame: 0, fastener: "pin" }
        : { style, paper: all(0.04), reach: NONE, frame: 0, fastener: "none" };
  }
}

/** Paper plus reach: the whole margin between the image and the outer rect. */
export function outerInsets(spec: FrameSpec): Insets {
  return {
    t: spec.paper.t + spec.reach.t,
    r: spec.paper.r + spec.reach.r,
    b: spec.paper.b + spec.reach.b,
    l: spec.paper.l + spec.reach.l,
  };
}
