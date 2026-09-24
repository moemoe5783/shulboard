"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { connectTv, type ConnectTvState } from "../screens/actions";

export function ConnectForm({
  screens,
  initialCode,
}: {
  screens: { id: string; name: string; note: string | null }[];
  initialCode: string;
}) {
  const [state, action, pending] = useActionState<ConnectTvState, FormData>(connectTv, {});
  const [screenId, setScreenId] = useState(screens.length === 1 ? screens[0].id : "");

  if (state.connected) {
    return (
      <div role="status">
        <h2 className="text-heading">Connected</h2>
        <p className="text-body text-ink-soft mt-1">The TV will show {state.connected}&rsquo;s board in a few seconds.</p>
        <p className="text-body mt-4">
          <Link href={`/screens/${screenId}`} className="text-verdigris">
            Go to {state.connected}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-1">
        <legend className="text-meta text-ink-soft mb-1">Screen</legend>
        {screens.map((screen) => (
          <label
            key={screen.id}
            className={`rounded-control border-rule flex min-h-11 cursor-pointer items-center gap-3 border px-3 py-2 ${
              screenId === screen.id ? "bg-verdigris-wash" : "hover:bg-verdigris-wash/40"
            }`}
          >
            <input
              type="radio"
              name="screenId"
              value={screen.id}
              checked={screenId === screen.id}
              onChange={() => setScreenId(screen.id)}
              className="accent-verdigris size-4"
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-body">{screen.name}</span>
              {screen.note && <span className="text-meta text-ink-soft">{screen.note}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="sm:w-44">
        <Field
          id="connect-code"
          name="code"
          label="Code on the TV"
          inputMode="numeric"
          autoComplete="off"
          maxLength={7}
          defaultValue={initialCode}
          required
          className="numeric tracking-widest"
        />
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={pending || !screenId}>
          {pending ? "Connecting" : "Connect TV"}
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
