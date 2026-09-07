"use client";

import { useState, useTransition } from "react";
import { CHROME_BUTTON, CHROME_BUTTON_PRIMARY, CHROME_META } from "@/app/(dev)/editor-lab/chrome";
import type { BoardDoc } from "@/lib/board-doc";
import { discardBoardChanges, publishBoard } from "./actions";

/*
 * Publish, and the state it publishes from — design.md §4's editor header:
 * "Saved [Publish]". docs/plan.md's publish model: nothing an editor does
 * reaches a screen until this button is pressed.
 *
 * PublishState is owned by BoardEditor, not here — every autosave changes
 * whether there are unpublished changes, and BoardEditor is already the thing
 * threading saveBoardDoc's result through. This component only presents that
 * state and calls back up on publish and discard, the same division
 * BoardEditor already has with its own save indicator.
 */

export type PublishState = {
  /** Null means never published — a distinct state from published-with-changes,
   *  and the two are said differently below. */
  publishedAt: string | null;
  /** How many screens show this board, as of the last time this was known —
   *  page load, or the last publish. Only used for the button's label; the
   *  publish action itself recomputes it fresh. */
  screenCount: number;
  /** A fresh hash of the draft differs from published_hash — or published_hash
   *  is null, which also counts, since "never published" is also "not what's
   *  live." */
  pendingChanges: boolean;
};

export function PublishControls({
  boardId,
  state,
  onPublished,
  onDiscarded,
}: {
  boardId: string;
  state: PublishState;
  onPublished: (result: { publishedAt: string; screenCount: number }) => void;
  onDiscarded: (doc: BoardDoc) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const neverPublished = state.publishedAt === null;
  const stateLabel = neverPublished
    ? "Never published"
    : state.pendingChanges
      ? "Unpublished changes"
      : "Published";

  const publishLabel =
    state.screenCount === 0 ? "Publish" : `Publish to ${state.screenCount} ${state.screenCount === 1 ? "screen" : "screens"}`;

  function publish() {
    setError(null);
    startTransition(async () => {
      const result = await publishBoard(boardId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onPublished(result);
    });
  }

  function discard() {
    setError(null);
    startTransition(async () => {
      const result = await discardBoardChanges(boardId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmingDiscard(false);
      onDiscarded(result.doc);
    });
  }

  if (confirmingDiscard) {
    return (
      <div className="flex items-center gap-3">
        <span className={CHROME_META}>
          Whatever you&rsquo;ve changed since publishing will be lost. The draft
          goes back to what&rsquo;s live now.
        </span>
        <button type="button" onClick={discard} disabled={pending} className={CHROME_BUTTON}>
          Discard changes
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDiscard(false)}
          disabled={pending}
          className={CHROME_BUTTON}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {error && (
        <span className={CHROME_META} role="alert">
          {error}
        </span>
      )}
      <span className={CHROME_META}>{stateLabel}</span>
      {!neverPublished && state.pendingChanges && (
        <button
          type="button"
          onClick={() => setConfirmingDiscard(true)}
          disabled={pending}
          className={CHROME_BUTTON}
        >
          Discard changes
        </button>
      )}
      <button
        type="button"
        onClick={publish}
        disabled={pending || !state.pendingChanges}
        className={CHROME_BUTTON_PRIMARY}
      >
        {pending ? "Publishing…" : publishLabel}
      </button>
    </div>
  );
}
