"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { boardDocAsJson, emptyBoardDoc } from "@/lib/board-doc";
import { requireActiveOrg } from "@/lib/orgs";
import { resolutionById } from "@/lib/screens";
import { createClient } from "@/lib/supabase/server";

export type BoardFormState = { error?: string };

export async function createBoard(
  _previous: BoardFormState,
  formData: FormData,
): Promise<BoardFormState> {
  const org = await requireActiveOrg();

  const name = String(formData.get("name") ?? "").trim();
  const resolution = resolutionById(String(formData.get("resolution") ?? ""));

  if (!name) return { error: "Give the board a name." };
  if (!resolution) return { error: "Pick a resolution." };

  const supabase = await createClient();

  // Unlike orgs and screens, boards need no insert-then-read-back dance: the
  // select policy is plain org membership, which this user already has before
  // the row exists — there is no trigger creating a prerequisite row after the
  // fact for RETURNING to race against.
  const { data, error } = await supabase
    .from("boards")
    .insert({
      org_id: org.orgId,
      name,
      canvas_width: resolution.width,
      canvas_height: resolution.height,
      doc: boardDocAsJson(emptyBoardDoc()),
    })
    .select("id")
    .single();

  if (error) {
    return { error: `That didn't save: ${error.message}. Check the name and try again.` };
  }

  revalidatePath("/boards");
  redirect(`/boards/${data.id}`);
}

export async function renameBoard(boardId: string, formData: FormData): Promise<void> {
  await requireActiveOrg();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const supabase = await createClient();
  const { error } = await supabase.from("boards").update({ name }).eq("id", boardId);
  if (error) throw new Error(`Couldn't rename the board: ${error.message}`);

  revalidatePath("/boards");
}
