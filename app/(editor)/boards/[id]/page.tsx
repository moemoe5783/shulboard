import { notFound } from "next/navigation";
import { requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { BoardEditor } from "./BoardEditor";

/*
 * The real editor — plan.md §4, at /boards/[id] rather than /editor-lab.
 *
 * A SEPARATE ROUTE GROUP, deliberately. This page shares no layout with
 * app/(app) — no nav rail, no padded content pane — because design.md §4's
 * editor is its own full-screen dark chrome, and the two route groups is how
 * Next.js lets one segment opt out of a layout its sibling still uses. See
 * app/(app)/boards/page.tsx for the list this is reached from.
 */

export const dynamic = "force-dynamic";

export default async function BoardEditorPage({ params }: PageProps<"/boards/[id]">) {
  const { id } = await params;
  const org = await requireActiveOrg();
  const supabase = await createClient();

  const { data: board, error } = await supabase
    .from("boards")
    .select("id, name, canvas_width, canvas_height, doc")
    .eq("id", id)
    .eq("org_id", org.orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Couldn't load the board: ${error.message}`);
  }
  if (!board) {
    notFound();
  }

  return (
    <BoardEditor
      boardId={board.id}
      name={board.name}
      canvas={{ width: board.canvas_width, height: board.canvas_height }}
      doc={board.doc}
    />
  );
}
