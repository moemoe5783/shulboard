"use server";

import { BoardDocError, boardDocAsJson, parseBoardDoc } from "@/lib/board-doc";
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
 */

export type SaveResult = { ok: true } | { ok: false; error: string };

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
  const { error } = await supabase
    .from("boards")
    .update({ doc: boardDocAsJson(parsed), updated_by: user.id })
    .eq("id", boardId);

  if (error) return { ok: false, error: `Couldn't save: ${error.message}` };
  return { ok: true };
}
