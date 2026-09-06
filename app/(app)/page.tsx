import Link from "next/link";
import { buttonClassName } from "@/components/Button";
import { requestNow } from "@/lib/clock";
import { requireActiveOrg } from "@/lib/orgs";
import { lastSeenLabel, screenStatus } from "@/lib/screens";
import { createClient } from "@/lib/supabase/server";
import { AttentionTable, type AttentionRow } from "./AttentionTable";

/*
 * The overview — the three-second question from design.md §1: is every screen in
 * the building alive, and is anything asking for me.
 *
 * Deliberately not a second copy of the screens list. It answers in one sentence
 * and then shows only what is wrong, because a wall of green rows is a list of
 * database rows, and the thing a gabbai is afraid of is the one row that is not.
 *
 * Read with the anon key through RLS, like everything else.
 */

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const org = await requireActiveOrg();
  const supabase = await createClient();

  const { data: screens, error } = await supabase
    .from("screens")
    .select("id, name, location_note, last_seen_at")
    .eq("org_id", org.orgId)
    .order("name");

  if (error) {
    throw new Error(`Couldn't load your screens: ${error.message}`);
  }

  const now = requestNow();
  const all = (screens ?? []).map((screen) => ({
    ...screen,
    status: screenStatus(screen.last_seen_at, now),
  }));

  const live = all.filter((screen) => screen.status === "live").length;

  const rows: AttentionRow[] = all
    .filter((screen) => screen.status !== "live")
    .map((screen) => ({
      id: screen.id,
      name: screen.name,
      location: screen.location_note,
      status: screen.status,
      lastSeen: lastSeenLabel(screen.last_seen_at, now),
      // A screen that has never reported has not been set up yet; one that used
      // to report and stopped is a device to go and look at. Different problem,
      // different sentence.
      todo: screen.last_seen_at
        ? "Check the device is on and connected"
        : "Open its display link on the device",
    }));

  return (
    <>
      <div>
        <h1 className="text-title">{org.name}</h1>
        {all.length > 0 && (
          <p className="text-body text-ink-soft numeric mt-1">
            {live === all.length
              ? `All ${all.length} ${all.length === 1 ? "screen is" : "screens are"} live.`
              : `${live} of ${all.length} ${all.length === 1 ? "screen is" : "screens are"} live.`}
          </p>
        )}
      </div>

      <div className="rounded-panel border-rule bg-surface mt-6 border pb-5">
        <section>
          <h2 className="text-heading px-5 pt-5 pb-3">Needs attention</h2>
          <AttentionTable
            rows={rows}
            empty={
              all.length === 0
                ? {
                    title: "Add your first screen",
                    description:
                      "Each screen gets its own link you open on the TV or display device.",
                    action: (
                      <Link href="/screens/new" className={buttonClassName("primary")}>
                        Add screen
                      </Link>
                    ),
                  }
                : {
                    title: "Everything's checked in",
                    description:
                      "Every screen reported in the last few minutes. Nothing is waiting on you.",
                  }
            }
          />
        </section>
      </div>
    </>
  );
}
