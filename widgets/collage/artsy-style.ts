import type { CSSProperties } from "react";
import { boardLength } from "@/lib/board-theme";
import type { ArtsyBackdrop, CollageConfig } from "./manifest";

/*
 * How the Artsy collage looks — paper, wood, tape, pins, shadows, backdrops.
 *
 * BOARD CONTENT, NOT CHROME (CLAUDE.md, "Scope"). These are the colours of a
 * print on a shul's board: warm Polaroid paper, walnut, cork. They are the
 * picture, like a photograph's own colours, and the chrome palette does not
 * govern them.
 *
 * NO IMAGE ASSETS. Every texture here — wood grain, cork, linen, kraft, tape —
 * is a CSS gradient, sized in board lengths so it scales with the screen.
 * Nothing to download, so it all works offline from the first boot, and the
 * whole "asset pack" is these few lines. A gradient is painted once and then
 * cached like any other layer, so a TV isn't redrawing it each frame.
 */

const u = (units: number, canvasWidth: number) => boardLength(units, canvasWidth);

/** Warm paper for Polaroids, a touch cooler for prints — per item, for a
 *  little variety between prints. */
const POLAROID_PAPER = ["#fbf8f1", "#f8f3e8", "#faf6ee", "#f5efe2"];
const PRINT_PAPER = ["#ffffff", "#fdfdfb", "#fcfbf8", "#fefdfa"];

/** Oak, walnut and a mid-brown; the grain is drawn over whichever. */
const WOOD = ["#a8743f", "#6f4526", "#8b5a30"];

export type ShadowStrength = CollageConfig["artsyShadow"];

/**
 * Layered shadows lit from the top left: one tight and darker, one soft and
 * wide (box-shadow, never filter: drop-shadow — spec §6, it's slow on a TV).
 */
export function printShadow(strength: ShadowStrength, canvasWidth: number): string {
  const [tx, ty, tb, ta, wx, wy, wb, wa] =
    strength === "soft"
      ? [1, 1.5, 3, 0.16, 3, 6, 14, 0.12]
      : strength === "strong"
        ? [2, 3, 5, 0.3, 9, 15, 30, 0.26]
        : [1.5, 2, 4, 0.22, 6, 10, 22, 0.18];
  return `${u(tx, canvasWidth)} ${u(ty, canvasWidth)} ${u(tb, canvasWidth)} rgba(0,0,0,${ta}), ${u(wx, canvasWidth)} ${u(wy, canvasWidth)} ${u(wb, canvasWidth)} rgba(0,0,0,${wa})`;
}

/** The paper (or frame) behind one print. */
export function paperStyle(
  style: string,
  variation: { tint: number; tone: number; grain: number },
  hero: boolean,
  frameUnits: number,
  canvasWidth: number,
): CSSProperties {
  switch (style) {
    case "polaroid":
      return {
        backgroundColor: POLAROID_PAPER[variation.tint % POLAROID_PAPER.length],
        // A faint lift at the top-left corner and a vignette at the edges.
        backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.55), rgba(255,255,255,0) 40%, rgba(0,0,0,0.035))",
      };
    case "classic":
    case "taped":
    case "pinned":
      return {
        backgroundColor: PRINT_PAPER[variation.tint % PRINT_PAPER.length],
        backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.4), rgba(0,0,0,0.03))",
      };
    case "wood": {
      const base = WOOD[variation.tone % WOOD.length];
      const grain = Math.round(variation.grain * 40);
      // The grain shows through translucent borders shaded per side, which is
      // what gives the corners their mitre and the frame its bevel.
      return {
        backgroundColor: base,
        backgroundImage: `repeating-linear-gradient(${88 + grain / 10}deg, rgba(0,0,0,0.09) 0 ${u(1.2, canvasWidth)}, rgba(255,255,255,0.04) ${u(1.2, canvasWidth)} ${u(3.5, canvasWidth)}, rgba(0,0,0,0.05) ${u(3.5, canvasWidth)} ${u(4.2, canvasWidth)})`,
        backgroundPosition: `${grain}% 0`,
        border: `${u(frameUnits, canvasWidth)} solid transparent`,
        borderTopColor: "rgba(255,235,205,0.16)",
        borderLeftColor: "rgba(255,235,205,0.08)",
        borderRightColor: "rgba(0,0,0,0.16)",
        borderBottomColor: "rgba(0,0,0,0.26)",
        backgroundClip: "border-box",
        backgroundOrigin: "border-box",
        boxSizing: "border-box",
      };
    }
    case "gallery": {
      // Black by default; a hero gets gold, which is how a wall of them is
      // usually hung.
      const gold = hero;
      return {
        backgroundColor: gold ? "#b8903e" : "#161616",
        backgroundImage: gold
          ? "linear-gradient(135deg, #d9b765, #f3dd98 30%, #b0873a 60%, #e2c276)"
          : "linear-gradient(135deg, #2a2a2a, #111 50%, #232323)",
        border: `${u(frameUnits, canvasWidth)} solid transparent`,
        borderTopColor: "rgba(255,255,255,0.12)",
        borderRightColor: "rgba(0,0,0,0.25)",
        borderBottomColor: "rgba(0,0,0,0.35)",
        borderLeftColor: "rgba(255,255,255,0.06)",
        backgroundClip: "border-box",
        backgroundOrigin: "border-box",
        boxSizing: "border-box",
      };
    }
    default:
      return { backgroundColor: "#ffffff" };
  }
}

/** The mat inside a wood or gallery frame, with the frame's shadow on it. */
export function matStyle(canvasWidth: number): CSSProperties {
  return {
    backgroundColor: "#f8f6f1",
    boxShadow: `inset ${u(1.5, canvasWidth)} ${u(2, canvasWidth)} ${u(4, canvasWidth)} rgba(0,0,0,0.32)`,
  };
}

const TAPE = ["rgba(244,238,212,0.85)", "rgba(250,234,160,0.8)", "rgba(206,228,234,0.82)"];
const PINS = [
  ["#ff8a80", "#d32f2f", "#7f1010"],
  ["#82b1ff", "#1e5bd6", "#0d2c6b"],
  ["#b9f6ca", "#2e9d57", "#10532a"],
];

export function tapeStyle(variant: number, canvasWidth: number): CSSProperties {
  return {
    backgroundColor: TAPE[variant % TAPE.length],
    // Torn ends: a little zigzag clipped off each short side.
    clipPath: "polygon(2% 0, 98% 0, 100% 20%, 97% 40%, 100% 60%, 97% 80%, 99% 100%, 1% 100%, 3% 80%, 0 60%, 3% 40%, 0 20%)",
    // A faint sheen along the strip, which is what reads as tape rather than
    // a pale rectangle.
    backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%, rgba(0,0,0,0.05))",
    boxShadow: `0 ${u(1, canvasWidth)} ${u(2, canvasWidth)} rgba(0,0,0,0.14)`,
  };
}

export function pinStyle(variant: number, canvasWidth: number): CSSProperties {
  const [light, mid, dark] = PINS[variant % PINS.length];
  return {
    borderRadius: "50%",
    backgroundImage: `radial-gradient(circle at 35% 32%, ${light}, ${mid} 55%, ${dark})`,
    boxShadow: `${u(2, canvasWidth)} ${u(3, canvasWidth)} ${u(3, canvasWidth)} rgba(0,0,0,0.35)`,
  };
}

/** The backdrop behind every print — none lets the widget's own background,
 *  or the board, show through. */
export function backdropStyle(backdrop: ArtsyBackdrop, color: string, canvasWidth: number): CSSProperties {
  const px = (v: number) => u(v, canvasWidth);
  switch (backdrop) {
    case "cork":
      return {
        backgroundColor: "#b98a58",
        backgroundImage: [
          `radial-gradient(rgba(96,58,24,0.45) ${px(1)}, transparent ${px(1.6)})`,
          `radial-gradient(rgba(255,228,184,0.3) ${px(1)}, transparent ${px(1.8)})`,
          `radial-gradient(rgba(70,40,14,0.3) ${px(1.5)}, transparent ${px(2.4)})`,
        ].join(", "),
        backgroundSize: `${px(7)} ${px(7)}, ${px(11)} ${px(9)}, ${px(17)} ${px(19)}`,
        backgroundPosition: `0 0, ${px(3)} ${px(5)}, ${px(8)} ${px(2)}`,
      };
    case "lightWood":
    case "darkWood": {
      const dark = backdrop === "darkWood";
      return {
        backgroundColor: dark ? "#5b3a22" : "#d6b385",
        backgroundImage: [
          // Planks.
          `repeating-linear-gradient(90deg, rgba(0,0,0,${dark ? 0.35 : 0.14}) 0 ${px(2)}, transparent ${px(2)} ${px(180)})`,
          // Grain.
          `repeating-linear-gradient(90deg, rgba(0,0,0,${dark ? 0.08 : 0.04}) 0 ${px(3)}, rgba(255,255,255,${dark ? 0.02 : 0.05}) ${px(3)} ${px(9)})`,
        ].join(", "),
      };
    }
    case "linen":
      return {
        backgroundColor: "#ebe4d6",
        backgroundImage: [
          `repeating-linear-gradient(0deg, rgba(120,100,70,0.07) 0 ${px(1)}, transparent ${px(1)} ${px(3)})`,
          `repeating-linear-gradient(90deg, rgba(120,100,70,0.06) 0 ${px(1)}, transparent ${px(1)} ${px(3.4)})`,
        ].join(", "),
      };
    case "kraft":
      return {
        backgroundColor: "#c7a372",
        backgroundImage: [
          `radial-gradient(rgba(90,62,30,0.25) ${px(0.8)}, transparent ${px(1.4)})`,
          `radial-gradient(rgba(255,240,210,0.18) ${px(1)}, transparent ${px(1.6)})`,
        ].join(", "),
        backgroundSize: `${px(9)} ${px(8)}, ${px(13)} ${px(15)}`,
        backgroundPosition: `0 0, ${px(4)} ${px(6)}`,
      };
    case "solid":
      return { backgroundColor: color };
    default:
      return {};
  }
}
