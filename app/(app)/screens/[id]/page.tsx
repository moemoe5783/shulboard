import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRoleAtLeast, requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/clock";
import { requestOrigin } from "@/lib/origin";
import { formatResolution, lastSeenLabel, screenStatus, type ScreenStatus } from "@/lib/screens";
import { BoardPicker } from "./BoardPicker";
import { DisplayLink } from "./DisplayLink";
import { ScreenSettings } from "./ScreenSettings";
import { ConnectTvForm, DisconnectTv } from "./TvConnection";

/*
 * One screen: its link, and the two things you can do to it.
 *
 * Read with the anon key through RLS. The id in the URL is not a permission —
 * a screen belonging to another shul matches no row and this 404s, which is the
 * select policy doing the work rather than a check written here.
 */

export const dynamic = "force-dynamic";

const STATUS_DOT: Record<ScreenStatus, string> = {
  live: "bg-live",
  stale: "bg-stale",
  offline: "bg-offline",
};

export default async function ScreenPage({ params, searchParams }: PageProps<"/screens/[id]">) {
  const { id } = await params;
  const { rotated, disconnected } = await searchParams;

  const org = await requireActiveOrg();
  const supabase = await createClient();

  const { data: screen, error } = await supabase
    .from("screens")
    .select(
      "id, name, location_note, token, canvas_width, canvas_height, last_seen_at, playlist_id, device_label, device_paired_at",
    )
    .eq("id", id)
    .eq("org_id", org.orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Couldn't load the screen: ${error.message}`);
  }
  if (!screen) {
    notFound();
  }

  // The board currently assigned — read off the playlist's first item, since
  // a screen always has at most one item until multi-board rotation exists
  // (plan.md §1, §6). "Nothing scheduled" and "the playlist was emptied out
  // from under it" are both just "no item", and look the same from here.
  let currentBoardId: string | null = null;
  if (screen.playlist_id) {
    const { data: item } = await supabase
      .from("playlist_items")
      .select("board_id")
      .eq("playlist_id", screen.playlist_id)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    currentBoardId = item?.board_id ?? null;
  }

  const { data: boards, error: boardsError } = await supabase
    .from("boards")
    .select("id, name, published_at")
    .eq("org_id", org.orgId)
    .is("deleted_at", null)
    .order("name");

  if (boardsError) {
    throw new Error(`Couldn't load the boards: ${boardsError.message}`);
  }

  const now = requestNow();
  const status = screenStatus(screen.last_seen_at, now);
  const origin = await requestOrigin();
  const url = `${origin}/s/${screen.token}`;
  const canManage = hasRoleAtLeast(org.role, "admin");

  return (
    <div className="max-w-3xl">
      <Link href="/screens" className="text-meta text-verdigris">
        Screens
      </Link>
      <h1 className="text-title mt-1">{screen.name}</h1>
      {screen.location_note && (
        <p className="text-body text-ink-soft mt-1">{screen.location_note}</p>
      )}

      <div className="rounded-panel border-rule bg-surface mt-6 border">
        <section className="border-rule border-b p-4 sm:p-6">
          <h2 className="text-heading">TV</h2>
          {screen.device_paired_at ? (
            <>
              <p className="text-body mt-1">
                Connected to {screen.device_label && screen.device_label !== "Connected by link" ? `a ${screen.device_label}` : "a TV"}
                {screen.device_paired_at &&
                  ` since ${new Date(screen.device_paired_at).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}`}
                .
              </p>
              <p className="text-body text-ink-soft mt-1 max-w-prose">
                Only that TV can show this screen&rsquo;s board. To use a different TV, disconnect this one first.
              </p>
              {canManage && (
                <div className="mt-4">
                  <DisconnectTv screenId={screen.id} />
                </div>
              )}
            </>
          ) : (
            <>
              {disconnected && <p className="text-body mt-1">TV disconnected. Connect the new one below.</p>}
              <p className="text-body text-ink-soft mt-1 max-w-prose">
                No TV is connected yet. On the TV, open <span className="text-ink">{origin.replace(/^https?:\/\//, "")}/pair</span>{" "}
                and it will show a code. Enter it here, or scan the TV&rsquo;s QR code with your phone.
              </p>
              {canManage ? (
                <div className="mt-4">
                  <ConnectTvForm screenId={screen.id} />
                </div>
              ) : (
                <p className="text-meta text-ink-soft mt-3">Only an owner or admin can connect a TV.</p>
              )}
              {canManage && (
                <details className="mt-5">
                  <summary className="text-body text-verdigris cursor-pointer">Connect with a link instead</summary>
                  <p className="text-body text-ink-soft mt-2 max-w-prose">
                    Open this link on the TV. The first device to open it becomes this screen&rsquo;s TV, so don&rsquo;t
                    open it anywhere else first.
                  </p>
                  {rotated && <p className="text-body text-ink mt-3">Link rotated. Open the new one on the screen.</p>}
                  <div className="mt-3">
                    <DisplayLink url={url} />
                  </div>
                </details>
              )}
            </>
          )}
        </section>

        <section className="border-rule border-b p-4 sm:p-6">
          <h2 className="text-heading">Board</h2>
          <p className="text-body text-ink-soft mt-1 max-w-prose">
            Which design this screen shows. It updates the next time the screen
            rebuilds, usually within a few minutes.
          </p>
          <div className="mt-4">
            <BoardPicker
              screenId={screen.id}
              boards={(boards ?? []).map((board) => ({
                id: board.id,
                name: board.name,
                published: board.published_at !== null,
              }))}
              currentBoardId={currentBoardId}
            />
          </div>
        </section>

        <section className="border-rule border-b p-4 sm:p-6">
          <h2 className="text-heading">Status</h2>
          <dl className="mt-3 flex flex-col gap-2">
            <div className="text-cell flex gap-4">
              <dt className="text-ink-soft w-32 shrink-0">Last seen</dt>
              <dd className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
                <span className="numeric">{lastSeenLabel(screen.last_seen_at, now)}</span>
              </dd>
            </div>
            <div className="text-cell flex gap-4">
              <dt className="text-ink-soft w-32 shrink-0">Size</dt>
              <dd className="numeric">
                {formatResolution(screen.canvas_width, screen.canvas_height)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="p-4 sm:p-6">
          <h2 className="text-heading">Change the link or remove the screen</h2>
          <p className="text-body text-ink-soft mt-1 max-w-prose">
            Rotate the link if it has gone somewhere it shouldn&rsquo;t. Deleting
            the screen removes it from the wall for good.
          </p>
          <div className="mt-4">
            <ScreenSettings screenId={screen.id} />
          </div>
        </section>
      </div>
    </div>
  );
}
