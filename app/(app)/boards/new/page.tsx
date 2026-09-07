import { requireActiveOrg } from "@/lib/orgs";
import { NewBoardForm } from "./NewBoardForm";

export const dynamic = "force-dynamic";

export default async function NewBoardPage() {
  await requireActiveOrg();

  return (
    <div className="max-w-xl">
      <h1 className="text-title">Add board</h1>
      <p className="text-body text-ink-soft mt-1">
        A board is the design a screen shows. You can put it on a screen once it
        has something on it.
      </p>

      {/* No panel around this — a form is a page of controls, not a bounded
          object (design.md §5). */}
      <div className="mt-6">
        <NewBoardForm />
      </div>
    </div>
  );
}
