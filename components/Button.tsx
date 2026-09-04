"use client";

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
  primary:
    "bg-verdigris text-surface px-3 enabled:hover:bg-verdigris-deep " +
    "disabled:bg-ink-faint disabled:text-surface",
  secondary:
    "border-rule-firm text-ink border bg-transparent px-3 " +
    "enabled:hover:bg-verdigris-wash/40 disabled:border-rule disabled:text-ink-faint",
  tertiary:
    "text-verdigris bg-transparent px-2 " +
    "enabled:hover:bg-verdigris-wash/40 disabled:text-ink-faint",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
