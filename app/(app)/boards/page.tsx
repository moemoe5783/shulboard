import Link from "next/link";
import { buttonClassName } from "@/components/Button";
import { BoardDocError, parseBoardDoc } from "@/lib/board-doc";
import { hashBoardDoc } from "@/lib/bundle/hash";
import { requireActiveOrg } from "@/lib/orgs";
import { formatResolution } from "@/lib/screens";
import { createClient } from "@/lib/supabase/server";
import { BoardsTable, type PublishStatus } from "./BoardsTable";

/** Never published and published-with-changes both mean "the draft and what's
 *  live disagree," but the boards list says them differently, same as the
 *  editor's own PublishControls.tsx. A doc that fails to parse counts as
 *  pending rather than silently reading as published. */
function publishStatus(doc: unknown, publishedHash: string | null): PublishStatus {
  if (publishedHash === null) return "never";
  try {
    return hashBoardDoc(parseBoardDoc(doc)) === publishedHash ? "published" : "pending";
  } catch (cause) {
    if (cause instanceof BoardDocError) return "pending";
    throw cause;
  }
}

/*
 * The boards list — plan.md §1's "a canvas design (the thing you edit)".
 *
 * Read with the anon key through RLS, like every other dashboard view: the
 * select policy on boards is is_org_member(org_id), so the org filter below is
 * belt to that braces rather than the thing keeping shuls apart.
 */

export const dynamic = "force-dynamic";

export default async function BoardsPage() {
  const org = await requireActiveOrg();
  const supabase = await createClient();

  const { data: boards, error } = await supabase
    .from("boards")
    .select("id, name, canvas_width, canvas_height, updated_at, doc, published_hash")
    .eq("org_id", org.orgId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Couldn't load the boards: ${error.message}`);
  }

  const rows = (boards ?? []).map((board) => ({
    id: board.id,
    name: board.name,
    size: formatResolution(board.canvas_width, board.canvas_height),
    status: publishStatus(board.doc, board.published_hash),
  }));

  return (
    <>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-title">Boards</h1>
          {rows.length > 0 && (
            <p className="text-body text-ink-soft mt-1">The designs your screens show.</p>
          )}
        </div>
        {rows.length > 0 && (
          <Link href="/boards/new" className={buttonClassName("primary")}>
            Add board
          </Link>
        )}
      </div>

      <div className="rounded-panel border-rule bg-surface mt-6 border">
        <BoardsTable rows={rows} />
      </div>
    </>
  );
}
