"use server";

import "server-only";

import { after } from "next/server";
import { BoardDocError, type BoardDoc, boardDocAsJson, parseBoardDoc } from "@/lib/board-doc";
import { screensShowingBoard } from "@/lib/board-screens";
import { buildScreenBundle } from "@/lib/bundle/build";
import { hashBoardDoc } from "@/lib/bundle/hash";
import { requireUser } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";

/*
 * The editor's one write path — plan.md §4c: "Autosave debounced 1s, with an
 * explicit save indicator." BoardEditor calls this from a debounced effect.
 *
 * RE-VALIDATED HERE, even though the Zustand store already holds a
 * schema-checked document. A Server Action is a public HTTP endpoint reachable
 * by anyone who can send the same POST (Next's own docs: "treat every action
 * as an untrusted entry point"), and CLAUDE.md's rule that no write path may
 * bypass parseBoardDoc() means this one too, not just the client's in-memory
 * copy.
 *
 * No revalidatePath here. The store is the authoritative copy of the document
 * for as long as the editor is open; re-fetching server data after every
 * autosave would cost a round trip for nothing the screen doesn't already show.
 *
 * THIS NEVER TOUCHES published_doc. Autosave writes the draft and nothing
 * else — docs/plan.md's publish model — so nothing an editor does here reaches
 * a screen. See publishBoard below for the one write path that does.
 */

export type SaveResult =
  | { ok: true; pendingChanges: boolean }
  | { ok: false; error: string };

export async function saveBoardDoc(boardId: string, doc: unknown): Promise<SaveResult> {
  const user = await requireUser();

  let parsed;
  try {
    parsed = parseBoardDoc(doc);
  } catch (cause) {
    const message = cause instanceof BoardDocError ? cause.message : "That board document isn't valid.";
    return { ok: false, error: message };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .update({ doc: boardDocAsJson(parsed), updated_by: user.id })
    .eq("id", boardId)
    .select("published_hash")
    .single();

  if (error || !data) return { ok: false, error: `Couldn't save: ${error?.message ?? "not found"}` };

  // Whether this save is null (never published) or a real, different hash —
  // both mean "the draft and what's live disagree," which is the only
  // question the caller needs answered after an autosave. Which of the two it
  // is doesn't change on autosave, so the caller already knows and keeps it.
  return { ok: true, pendingChanges: data.published_hash !== hashBoardDoc(parsed) };
}

/**
 * Publish — copies the draft to published_doc, stores its hash, and builds
 * the screens that show this board immediately rather than waiting for the
 * cron sweep. docs/plan.md: "the build must not block publishing," so the
 * builds run in `after()`, scheduled once the response above has already gone
 * out — a build that fails or times out here never undoes the publish that
 * already committed, and the daily cron worker picks up anything that didn't
 * finish, the same as it does for every other queued screen.
 */
export type PublishResult =
  | { ok: true; publishedAt: string; screenCount: number }
  | { ok: false; error: string };

export async function publishBoard(boardId: string): Promise<PublishResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: board, error } = await supabase
    .from("boards")
    .select("id, org_id, doc")
    .eq("id", boardId)
    .maybeSingle();

  if (error || !board) {
    return { ok: false, error: `Couldn't load the board: ${error?.message ?? "not found"}.` };
  }

  let parsed: BoardDoc;
  try {
    parsed = parseBoardDoc(board.doc);
  } catch (cause) {
    const message = cause instanceof BoardDocError ? cause.message : "That board document isn't valid.";
    return { ok: false, error: message };
  }

  const publishedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("boards")
    .update({
      published_doc: boardDocAsJson(parsed),
      published_hash: hashBoardDoc(parsed),
      published_at: publishedAt,
      published_by: user.id,
    })
    .eq("id", boardId);

  if (updateError) return { ok: false, error: `Couldn't publish: ${updateError.message}` };

  const screenIds = await screensShowingBoard(supabase, board.org_id, boardId);

  after(async () => {
    // Each build is independent and already never throws for an ordinary
    // failure (buildScreenBundle's own contract) — .catch() here is only for
    // the unexpected case, so one bad screen can't stop the rest.
    await Promise.all(screenIds.map((screenId) => buildScreenBundle(screenId).catch(() => null)));
  });

  return { ok: true, publishedAt, screenCount: screenIds.length };
}

/**
 * Discard — copies published_doc back over the draft. After this, a fresh
 * hash of the draft matches published_hash exactly, because they're now the
 * same document; there's no separate "mark as clean" step.
 */
export type DiscardResult = { ok: true; doc: BoardDoc } | { ok: false; error: string };

export async function discardBoardChanges(boardId: string): Promise<DiscardResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: board, error } = await supabase
    .from("boards")
    .select("published_doc")
    .eq("id", boardId)
    .maybeSingle();

  if (error || !board) {
    return { ok: false, error: `Couldn't load the board: ${error?.message ?? "not found"}.` };
  }
  if (board.published_doc === null) {
    return { ok: false, error: "This board has never been published, so there's nothing to discard back to." };
  }

  let parsed: BoardDoc;
  try {
    parsed = parseBoardDoc(board.published_doc);
  } catch (cause) {
    const message = cause instanceof BoardDocError ? cause.message : "The published version isn't valid.";
    return { ok: false, error: message };
  }

  const { error: updateError } = await supabase
    .from("boards")
    .update({ doc: boardDocAsJson(parsed), updated_by: user.id })
    .eq("id", boardId);

  if (updateError) return { ok: false, error: `Couldn't discard the changes: ${updateError.message}` };

  return { ok: true, doc: parsed };
}
