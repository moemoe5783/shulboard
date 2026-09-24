"use client";

import { startTransition, useActionState, useState } from "react";
import { SelectField, Field } from "@/components/Field";
import { Button } from "@/components/Button";
import { PLAN_LABELS, PLANS, type Plan } from "@/lib/plans";
import { setOrgPlan, type SetPlanState } from "../../actions";

/** A shul's plan, and when its free trial ends. */
export function PlanForm({ orgId, plan, trialEndsAt }: { orgId: string; plan: string; trialEndsAt: string | null }) {
  const [state, action, pending] = useActionState<SetPlanState, FormData>(setOrgPlan, {});
  const [chosen, setChosen] = useState<Plan>((PLANS as readonly string[]).includes(plan) ? (plan as Plan) : "trial");
  const [trialEnds, setTrialEnds] = useState(trialEndsAt ? trialEndsAt.slice(0, 10) : "");
  const [dirtyAfter, setDirtyAfter] = useState<number | undefined>(undefined);
  const saved = state.saved && state.at !== dirtyAfter;

  return (
    <form
      // Submitted by hand, not through `action={…}`, so React's reset of the
      // form after the action doesn't put the fields back (BoardPicker.tsx).
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(() => action(form));
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <SelectField
            id="plan"
            name="plan"
            label="Plan"
            value={chosen}
            onChange={(event) => {
              setChosen(event.target.value as Plan);
              setDirtyAfter(state.at);
            }}
          >
            {PLANS.map((one) => (
              <option key={one} value={one}>
                {PLAN_LABELS[one]}
              </option>
            ))}
          </SelectField>
        </div>
        {chosen === "trial" && (
          <div className="w-48">
            <Field
              id="trialEnds"
              name="trialEnds"
              type="date"
              label="Trial ends"
              value={trialEnds}
              onChange={(event) => {
                setTrialEnds(event.target.value);
                setDirtyAfter(state.at);
              }}
            />
          </div>
        )}
        <Button type="submit" variant="primary" busy={pending}>
          {pending ? "Saving" : "Save plan"}
        </Button>
        {saved && !pending && (
          <span role="status" className="text-body text-ink-soft">
            Saved
          </span>
        )}
      </div>
      {chosen === "trial" && !trialEnds && (
        <p className="text-meta text-ink-soft">No end date: the trial runs until you change it.</p>
      )}
      {state.error && (
        <p role="alert" className="text-body text-ink">
          {state.error}
        </p>
      )}
    </form>
  );
}
