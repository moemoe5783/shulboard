"use client";

import { useActionState } from "react";
import { Button } from "@/components/Button";
import { acceptInvite, type AcceptState } from "./actions";

export function JoinButton({ token, shulName }: { token: string; shulName: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInvite, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Joining" : `Join ${shulName}`}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-body text-ink">
          {state.error}
        </p>
      )}
    </form>
  );
}
