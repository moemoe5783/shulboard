/*
 * Keeps a TV's forced dark mode off the board.
 *
 * Many TV and phone browsers have a "dark mode for web pages" that repaints
 * light pages dark: a white board went black, its dark text stayed on it, and
 * a QR code's squares turned white on a white square — gone. Measured in
 * Chromium with forced dark on, and `color-scheme: only light` does not stop
 * it. What does is the page saying it already handles dark itself: a page
 * whose root is `color-scheme: dark` is left exactly as drawn.
 *
 * That's true of the TV routes (the board and the pairing screen), which set
 * every colour they show themselves and hold no native form controls for the
 * scheme to restyle. So they, and only they, declare it — the dashboard stays
 * light (app/globals.css). Rendered in the page body, after the global
 * stylesheet, so it wins at the same specificity.
 */
export function TvColorScheme() {
  return <style>{":root{color-scheme:dark}body{background-color:var(--ink)}"}</style>;
}
