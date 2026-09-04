import { getMemberships, requireUser } from "@/lib/orgs";
import { NewOrgForm } from "./NewOrgForm";

/**
 * The step before everything else: a signed-in user with no shul.
 *
 * Also reachable later from the switcher, for a gabbai who runs two.
 */
export default async function NewOrgPage() {
  await requireUser();
  const memberships = await getMemberships();

  // Intl.supportedValuesOf is the whole IANA list, which is the right answer for
  // a product where the timezone decides when candle lighting is.
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <h1 className="text-title">
          {memberships.length === 0 ? "Add your shul" : "Add another shul"}
        </h1>
        <p className="text-body text-ink-soft mt-1">
          Screens, boards and notices all belong to a shul. You can rename it
          later.
        </p>

        <div className="rounded-panel border-rule bg-surface mt-6 border p-6">
          <NewOrgForm timezones={timezones} />
        </div>
      </div>
    </main>
  );
}
