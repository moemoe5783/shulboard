import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireActiveOrg } from "@/lib/orgs";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/clock";
import { formatResolution, lastSeenLabel, screenStatus, type ScreenStatus } from "@/lib/screens";
import { DisplayLink } from "./DisplayLink";
import { ScreenSettings } from "./ScreenSettings";

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

/**
 * The origin the gabbai is actually looking at.
 *
 * The link gets typed into a TV remote, so it has to be the host they know, not
 * a build-time guess. Vercel sets x-forwarded-proto; local dev doesn't, and
 * there http is right.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function ScreenPage({ params, searchParams }: PageProps<"/screens/[id]">) {
  const { id } = await params;
  const { rotated } = await searchParams;

  const org = await requireActiveOrg();
  const supabase = await createClient();

  const { data: screen, error } = await supabase
    .from("screens")
    .select(
      "id, name, location_note, token, canvas_width, canvas_height, last_seen_at, playlist_id",
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

  let showing = "Nothing scheduled";
  if (screen.playlist_id) {
    const { data: playlist } = await supabase
      .from("playlists")
      .select("name")
      .eq("id", screen.playlist_id)
      .maybeSingle();
    showing = playlist?.name ?? "A playlist that was removed";
  }

  const now = requestNow();
  const status = screenStatus(screen.last_seen_at, now);
  const url = `${await requestOrigin()}/s/${screen.token}`;

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
        <section className="border-rule border-b p-6">
          <h2 className="text-heading">Display link</h2>
          <p className="text-body text-ink-soft mt-1 max-w-prose">
            Open this on the TV or display device. It needs no sign-in, so treat
            it like a key: anyone with the link can see the board.
          </p>
          {rotated && (
            <p className="text-body text-ink mt-3">
              Link rotated. Open the new one on the screen.
            </p>
          )}
          <div className="mt-4">
            <DisplayLink url={url} />
          </div>
        </section>

        <section className="border-rule border-b p-6">
          <h2 className="text-heading">Status</h2>
          <dl className="mt-3 flex flex-col gap-2">
            <div className="text-cell flex gap-4">
              <dt className="text-ink-soft w-32 shrink-0">Last seen</dt>
              <dd className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
                <span>{lastSeenLabel(screen.last_seen_at, now)}</span>
              </dd>
            </div>
            <div className="text-cell flex gap-4">
              <dt className="text-ink-soft w-32 shrink-0">Showing</dt>
              <dd>{showing}</dd>
            </div>
            <div className="text-cell flex gap-4">
              <dt className="text-ink-soft w-32 shrink-0">Size</dt>
              <dd>{formatResolution(screen.canvas_width, screen.canvas_height)}</dd>
            </div>
          </dl>
        </section>

        <section className="p-6">
          <h2 className="text-heading">Link and removal</h2>
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
