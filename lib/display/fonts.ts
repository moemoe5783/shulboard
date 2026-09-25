"use client";

import { useEffect, useState } from "react";
import type { BundleFonts } from "@/lib/fonts/board-fonts";

/*
 * A board's fonts, loaded before it is first shown — no flash of a fallback
 * face on a TV (plan.md §3c's loading screen, for type as well as photos).
 *
 * The files are already on the device by now: they are in the bundle's list
 * and cached with its pictures before a new bundle is taken (useDisplay.ts,
 * lib/display/assets.ts). What's left is asking the browser to actually load
 * each family the board draws in — document.fonts.load, with a sample of the
 * text that makes the right file load (Hebrew for a Hebrew-only family).
 * Capped: a face that never loads must not keep a board off the wall.
 */

const MAX_WAIT_MS = 8_000;

const spec = (face: BundleFonts["faces"][number]) => `${face.weight} 16px "${face.family}"`;

/** Whether every face is loaded already — true straight away for a board whose
 *  fonts arrived with an update, so it never shows a loading screen at all. */
export function fontsLoaded(fonts: BundleFonts | undefined): boolean {
  if (!fonts || typeof document === "undefined" || !document.fonts) return true;
  try {
    return fonts.faces.every((face) => document.fonts.check(spec(face), face.text));
  } catch {
    return true;
  }
}

/** Load every face the board uses; resolves when they're in, or after the cap. */
export async function loadFonts(fonts: BundleFonts | undefined): Promise<void> {
  if (!fonts || fonts.faces.length === 0 || typeof document === "undefined" || !document.fonts) return;
  const all = Promise.allSettled(fonts.faces.map((face) => document.fonts.load(spec(face), face.text)));
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, MAX_WAIT_MS))]);
}

/** For the board on screen: false until its fonts are loaded. */
export function useFontsReady(fonts: BundleFonts | undefined): boolean {
  const key = fonts ? fonts.faces.map(spec).join("|") : "";
  const [ready, setReady] = useState<{ key: string; ready: boolean }>(() => ({ key, ready: fontsLoaded(fonts) }));
  useEffect(() => {
    if (ready.key === key && ready.ready) return;
    let cancelled = false;
    if (fontsLoaded(fonts)) {
      queueMicrotask(() => !cancelled && setReady({ key, ready: true }));
      return;
    }
    void loadFonts(fonts).then(() => !cancelled && setReady({ key, ready: true }));
    return () => {
      cancelled = true;
    };
    // `key` stands for `fonts`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ready.key === key ? ready.ready : fontsLoaded(fonts);
}
