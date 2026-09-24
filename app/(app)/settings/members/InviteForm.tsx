"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import { inviteMember, type InviteState } from "./actions";

export function InviteForm({ canInviteAdmins, emailConfigured }: { canInviteAdmins: boolean; emailConfigured: boolean }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteMember, { status: "idle" });
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:flex-1">
          <Field id="invite-email" name="email" type="email" label="Email" required autoComplete="off" placeholder="gabbai@example.com" />
        </div>
        <div className="sm:w-40">
          <SelectField id="invite-role" name="role" label="Can" defaultValue="editor">
            <option value="editor">Edit boards</option>
            <option value="viewer">View only</option>
            {canInviteAdmins && <option value="admin">Manage everything</option>}
          </SelectField>
        </div>
        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Inviting" : "Invite"}
          </Button>
        </div>
      </form>

      {!emailConfigured && (
        <p className="text-meta text-ink-soft">
          Email isn&rsquo;t set up on this deployment yet, so invitations aren&rsquo;t emailed — you&rsquo;ll get a link to
          send yourself.
        </p>
      )}

      {state.status === "error" && (
        <p role="alert" className="text-body text-ink">
          {state.message}
        </p>
      )}

      {state.status === "done" && (
        <div role="status" className="flex flex-col gap-2">
          <p className="text-body">{state.sent ? `Invitation sent to ${state.email}.` : state.note}</p>
          {!state.sent && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={state.link}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Invitation link"
                className="text-cell rounded-control border-rule bg-paper h-8 w-full min-w-0 border px-2 sm:flex-1"
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(state.link);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
