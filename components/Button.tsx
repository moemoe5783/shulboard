import type { ButtonHTMLAttributes } from "react";

/*
 * Button — docs/design.md §5.
 *
 * Three variants and no fourth. One primary per view: verdigris marks the primary
 * action and nothing else, so a view with three verdigris buttons has no primary
 * action.
 *
 * There is deliberately no icon prop. The spec allows an icon only when it is
 * load-bearing, and every icon slot that exists gets filled eventually.
 *
 * NO "use client" HERE, ON PURPOSE — same reason as components/Table.tsx.
 * Nothing in this file uses a hook or attaches a handler of its own, so it is a
 * shared component: a server page renders it directly, a client page passes it
 * an onClick. Marking it client also turned buttonClassName() into a client
 * reference, which a server page cannot call at all — the build caught that on
 * app/not-found.tsx, and every dynamic server page using it would have thrown
 * the same way at request time.
 */

export type ButtonVariant = "primary" | "secondary" | "tertiary";

// 32px high, 5px radius, 14px label. Hover is a single flat color change with no
// transition — motion answers actions, and a hover is not an action.
const BASE =
  "text-cell rounded-control inline-flex h-8 shrink-0 items-center justify-center " +
  "whitespace-nowrap disabled:cursor-not-allowed";

const VARIANTS: Record<ButtonVariant, string> = {
  // White text on the accent. --surface is the palette's white; there is no
  // separate on-accent token because there is no second white.
  // Disabled keeps the accent and drops its opacity, the same move the secondary
  // makes when its border goes from --rule-firm to --rule: the same button, in an
  // unavailable state. A solid grey fill read as heavier than a live secondary,
  // which inverted the hierarchy.
  primary:
    "bg-verdigris text-surface px-3 enabled:hover:bg-verdigris-deep " +
    "disabled:bg-verdigris/40",
  secondary:
    "border-rule-firm text-ink border bg-transparent px-3 " +
    "enabled:hover:bg-verdigris-wash/40 disabled:border-rule disabled:text-ink-faint",
  tertiary:
    "text-verdigris bg-transparent px-2 " +
    "enabled:hover:bg-verdigris-wash/40 disabled:text-ink-faint",
};

/**
 * The button's classes, for the cases where the right element is a link.
 *
 * Navigation is an anchor: it gets middle-click, open-in-new-tab, and a status
 * bar showing where it goes, none of which a button with an onClick handler
 * has. Rather than growing an asChild prop, the styling is available on its own
 * and the caller picks the correct element.
 */
export function buttonClassName(variant: ButtonVariant = "secondary"): string {
  return `${BASE} ${VARIANTS[variant]}`;
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** The action it started is still running: the button is disabled, says
   *  so to a screen reader, and shows a small spinner before its label, so a
   *  click that takes a second or two never looks like it didn't land. */
  busy?: boolean;
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  busy = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANTS[variant]} ${busy ? "cursor-progress gap-2" : ""} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

/**
 * The busy mark. Load-bearing, which is what earns an icon inside a text
 * button (design.md §5): it is the answer to a click. Motion answers an action
 * here, and under reduced motion it stays still — the label change and the
 * disabled state still say the same thing.
 */
export function Spinner() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
