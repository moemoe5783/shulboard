import { requireActiveOrg } from "@/lib/orgs";
import { NewScreenForm } from "./NewScreenForm";

export const dynamic = "force-dynamic";

export default async function NewScreenPage() {
  await requireActiveOrg();

  return (
    <div className="max-w-xl">
      <h1 className="text-title">Add screen</h1>
      <p className="text-body text-ink-soft mt-1">
        Each screen gets its own link you open on the TV or display device.
      </p>

      {/* No panel around this. docs/design.md §5: a card is for a bounded
          object, and a form is not one — it is a page of controls. */}
      <div className="mt-6">
        <NewScreenForm />
      </div>
    </div>
  );
}
