import type { ReactNode } from "react";

/*
 * A page that reports a state instead of showing content — a failed load, a URL
 * that points at nothing.
 *
 * Same shape as an empty state, for the same reason: docs/design.md §5 wants an
 * instruction, not a mood. A heading that says what happened, one sentence
 * saying what to do, one action. No large centered icon, no apology, no "Error:"
 * prefix, and nothing written in the first person.
 *
 * `tone` decides whether the heading carries --offline. That colour means
 * something is genuinely wrong, which is true of a failed load and not true of a
 * URL that no longer resolves — a deleted screen is a normal outcome, not a
 * fault, and colouring it red would spend a status colour on a non-status.
 */

export type NoticeTone = "problem" | "plain";

export type NoticeProps = {
  tone?: NoticeTone;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Next's error digest. The one thing worth quoting when someone calls. */
  reference?: string;
};

export function Notice({ tone = "plain", title, children, actions, reference }: NoticeProps) {
  return (
    <div className="max-w-prose">
      <h1 className={`text-title ${tone === "problem" ? "text-offline" : "text-ink"}`}>
        {title}
      </h1>
      <p className="text-body text-ink-soft mt-2">{children}</p>
      {actions && <div className="mt-4 flex items-center gap-2">{actions}</div>}
      {reference && <p className="text-meta text-ink-soft numeric mt-4">Reference {reference}</p>}
    </div>
  );
}
