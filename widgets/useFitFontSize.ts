"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { boardFontSize } from "@/lib/board-theme";

/*
 * Auto-fit text sizing for `fit`-mode elements — docs/sizing.md §2: "the box is
 * authoritative... the renderer measures its container and computes a font
 * size that fills it, subject to a min and max. Not `font-size: Npx` from
 * config."
 *
 * There is no closed-form CSS for "the largest size at which this (possibly
 * wrapped) text still fits both axes of its box" — font-size and rendered
 * height aren't linearly related once wrapping is involved. So this measures:
 * binary search over font-size, applying each guess to the real DOM and
 * reading back scrollWidth/scrollHeight against the box's own
 * clientWidth/clientHeight. The same approach fitty/textFit use.
 *
 * The result is written straight to `contentRef`'s style rather than returned
 * through React state — that is what lets the ResizeObserver below re-run the
 * search on every frame of a resize drag without a re-render each time, and
 * it is safe precisely because a widget Renderer owns nothing else about
 * `contentRef` that React would fight over.
 */

// SSR renders these widgets once before hydration (see Clock's `second === null`
// placeholder), and useLayoutEffect warns when it runs during that render.
// Falling back to useEffect there costs nothing — there is nothing on screen to
// flash before hydration in the first place.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const SEARCH_ITERATIONS = 14;

/**
 * Resolves a design-unit length to the real pixels it renders as, right now,
 * in this box — by asking the browser rather than recomputing its cqw math.
 * `boardLength`/`boardFontSize` convert to a `cqw` string against the board's
 * own container query context; the only place that context is guaranteed
 * correct is a live element inside it, so this drops a hidden probe span into
 * the box, reads its resolved font-size, and removes it.
 */
function resolveDesignPx(designUnits: number, canvasWidth: number, reference: HTMLElement): number {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.fontSize = boardFontSize(designUnits, canvasWidth);
  reference.appendChild(probe);
  const resolved = parseFloat(getComputedStyle(probe).fontSize);
  reference.removeChild(probe);
  return Number.isFinite(resolved) ? resolved : designUnits;
}

export function useFitFontSize(
  boxRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  options: {
    minFontSize: number;
    maxFontSize: number;
    canvasWidth: number;
    /** Skip the search entirely for a `fixed`-mode instance — no observer, no
     *  measuring, nothing running in the background for the widget on screen
     *  for months that never needed it (plan.md §3e). */
    enabled: boolean;
    /** Anything that changes what is being measured — the text itself, the
     *  config that produced it — the same idea as a plain effect's deps. */
    deps: readonly unknown[];
  },
) {
  const { minFontSize, maxFontSize, canvasWidth, enabled, deps } = options;
  const pendingFrame = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!enabled || !box || !content) return;

    const search = () => {
      if (box.clientWidth === 0 || box.clientHeight === 0) return;

      const floor = resolveDesignPx(minFontSize, canvasWidth, box);
      const ceiling = resolveDesignPx(maxFontSize, canvasWidth, box);

      const fits = (px: number) => {
        content.style.fontSize = `${px}px`;
        return content.scrollWidth <= box.clientWidth && content.scrollHeight <= box.clientHeight;
      };

      // Doesn't fit even at the floor — docs/sizing.md §3's overflow case.
      // Settle there and no ellipsis; the shared clip in BoardRenderer's
      // WidgetFrame and its overflow flag take it from here.
      if (!fits(floor)) return;

      let lo = floor;
      let hi = ceiling;
      for (let i = 0; i < SEARCH_ITERATIONS; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      content.style.fontSize = `${lo}px`;
    };

    search();

    const observer = new ResizeObserver(() => {
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = requestAnimationFrame(search);
    });
    observer.observe(box);

    return () => {
      observer.disconnect();
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    };
    // `deps` is a caller-supplied list, the same idea as a plain effect's own
    // dependency array — its length just isn't static, which is what the
    // spread is for.
  }, [enabled, minFontSize, maxFontSize, canvasWidth, boxRef, contentRef, ...deps]);
}
