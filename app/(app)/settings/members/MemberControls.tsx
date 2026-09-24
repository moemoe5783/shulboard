"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import type { OrgRole } from "@/lib/orgs";
import { changeMemberRole, removeMember, resendInvite, revokeInvite } from "./actions";

/** A member's role, changeable in place. */
export function RoleField({ userId, role, canGrantOwner }: { userId: string; role: OrgRole; canGrantOwner: boolean }) {
  const [value, setValue] = useState(role);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col py-1">
      <select
        aria-label="Role"
        value={value}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value as OrgRole;
          const previous = value;
          setValue(next);
          setError(undefined);
          start(async () => {
            const result = await changeMemberRole(userId, next);
            if (result.error) {
              setValue(previous);
              setError(result.error);
            }
          });
        }}
        className="text-cell rounded-control border-rule bg-surface h-8 border px-1"
      >
        {canGrantOwner && <option value="owner">Owner</option>}
        <option value="admin">Admin</option>
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      {error && (
        <span role="alert" className="text-meta text-offline mt-1 max-w-48 whitespace-normal">
          {error}
        </span>
      )}
    </div>
  );
}

/** Remove someone from the shul (or leave it yourself), with a confirm step. */
export function MemberActions({ userId, name, self = false }: { userId: string; name: string; self?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <Button variant="tertiary" onClick={() => setConfirming(true)}>
        {self ? "Leave" : "Remove"}
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1 py-1">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await removeMember(userId);
              if (result?.error) setError(result.error);
            })
          }
        >
          {pending ? "Removing" : self ? "Leave the shul" : `Remove`}
        </Button>
        <Button variant="tertiary" onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </div>
      {!self && <span className="text-meta text-ink-soft whitespace-normal">{name} will lose access straight away.</span>}
      {error && (
        <span role="alert" className="text-meta text-offline max-w-56 whitespace-normal">
          {error}
        </span>
      )}
    </div>
  );
}

/** Copy the link, send it again, or withdraw it. */
export function InviteActions({ inviteId, email, link }: { inviteId: string; email: string; link: string }) {
  const [message, setMessage] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1 py-1">
      <div className="flex flex-wrap items-center justify-end gap-1 sm:flex-nowrap">
        <Button
          variant="tertiary"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button
          variant="tertiary"
          disabled={pending}
          onClick={() => start(async () => setMessage((await resendInvite(inviteId)).message))}
        >
          Send again
        </Button>
        <Button
          variant="tertiary"
          disabled={pending}
          aria-label={`Withdraw the invitation to ${email}`}
          onClick={() => start(async () => revokeInvite(inviteId))}
        >
          Withdraw
        </Button>
      </div>
      {message && <span className="text-meta text-ink-soft whitespace-normal">{message}</span>}
    </div>
  );
}
