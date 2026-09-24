"use client";

import { useEffect, useMemo, useState } from "react";
import { encode } from "uqr";
import { deviceSecret } from "@/lib/display/device";
import { formatPairingCode } from "@/lib/pairing";

/*
 * What a TV shows while it waits to be connected: a code big enough to read
 * from across the room, and a QR code that opens the Connect page on a phone
 * with the code already filled in. It asks for a code (POST /api/pair/start),
 * checks every few seconds whether it was entered (POST /api/pair/poll), and
 * when it was, stores the screen's link and opens the board — the same stored
 * token the display boots from after every power cut (app/s/[token]).
 *
 * Dark, like the waiting state on a screen: a bright rectangle in a dim lobby
 * is worse than a dark one.
 */

const TOKEN_KEY = "shulboard.screen.token";
const POLL_MS = 3000;

type State =
  | { phase: "starting" }
  | { phase: "showing"; code: string; expiresAt: number }
  | { phase: "unavailable"; message: string };

function storedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function PairScreen({ reason }: { reason?: string }) {
  const [state, setState] = useState<State>({ phase: "starting" });
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const secret = deviceSecret();
    const post = (path: string) =>
      fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
        cache: "no-store",
      });

    const open = (token: string) => {
      try {
        window.localStorage.setItem(TOKEN_KEY, token);
      } catch {
        // No storage: the board still opens; it just can't reopen itself.
      }
      window.location.replace(`/s/${token}`);
    };

    const start = async () => {
      try {
        const response = await post("/api/pair/start");
        if (cancelled) return;
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setState({ phase: "unavailable", message: body?.error ?? "Pairing isn't available right now." });
          timer = setTimeout(start, 30_000);
          return;
        }
        const body = (await response.json()) as { code: string; expiresAt: string };
        setState({ phase: "showing", code: body.code, expiresAt: new Date(body.expiresAt).getTime() });
        timer = setTimeout(poll, POLL_MS);
      } catch {
        if (cancelled) return;
        setState({ phase: "unavailable", message: "This TV isn't online. It will try again by itself." });
        timer = setTimeout(start, 15_000);
      }
    };

    const poll = async () => {
      try {
        const response = await post("/api/pair/poll");
        if (cancelled) return;
        const body = (await response.json().catch(() => ({}))) as { status?: string; token?: string };
        if (body.status === "paired" && body.token) return open(body.token);
        if (body.status === "expired") return void start();
      } catch {
        // Offline for a moment; keep the code on screen and ask again.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    // A TV that's already a screen's TV goes straight back to its board —
    // unless it was just sent here because that link stopped working.
    const kept = storedToken();
    Promise.resolve().then(() => {
      setOrigin(window.location.origin);
      if (kept && !reason) open(kept);
      else void start();
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reason]);

  const connectUrl = state.phase === "showing" && origin ? `${origin}/connect?code=${state.code}` : null;
  const qr = useMemo(() => {
    if (!connectUrl) return null;
    const { size, data } = encode(connectUrl, { ecc: "M", border: 0 });
    let d = "";
    data.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x + 2} ${y + 2}h1v1h-1z`)));
    return { extent: size + 4, d };
  }, [connectUrl]);

  return (
    <div className="bg-ink text-paper font-ui flex min-h-screen flex-col items-center justify-center gap-[4vh] px-[5vw] py-[5vh] text-center">
      {reason && (
        <p className="text-paper/70 text-[clamp(16px,2.2vw,36px)]">
          {reason === "other-tv"
            ? "That screen is connected to a different TV."
            : "This TV was disconnected from its screen."}
        </p>
      )}

      {state.phase === "showing" ? (
        <div className="flex flex-col items-center gap-[5vh] md:flex-row md:gap-[6vw]">
          <div className="flex flex-col items-center gap-[2vh]">
            <p className="text-paper/80 text-[clamp(18px,2.6vw,44px)]">To show a board on this TV, enter this code</p>
            <p
              data-pairing-code={state.code}
              className="numeric text-[clamp(56px,11vw,190px)] leading-none font-semibold tracking-[0.08em]"
              style={{ fontFamily: "var(--type-sefarim)" }}
            >
              {formatPairingCode(state.code)}
            </p>
            <p className="text-paper/70 max-w-[40ch] text-[clamp(14px,1.7vw,28px)]">
              In Shulboard, open Screens, choose the screen, and enter the code under &ldquo;TV&rdquo; — or scan the QR
              code with your phone.
            </p>
          </div>
          {qr && (
            <svg
              role="img"
              aria-label="QR code to connect this TV"
              viewBox={`0 0 ${qr.extent} ${qr.extent}`}
              shapeRendering="crispEdges"
              className="rounded-panel bg-surface size-[clamp(160px,26vw,420px)] shrink-0"
            >
              <path d={qr.d} className="fill-ink" />
            </svg>
          )}
        </div>
      ) : (
        <p className="text-paper/80 text-[clamp(18px,2.6vw,44px)]">
          {state.phase === "unavailable" ? state.message : "Getting a code…"}
        </p>
      )}

      {state.phase === "showing" && (
        <p className="text-paper/50 text-[clamp(12px,1.3vw,22px)]">A new code appears every 10 minutes until this TV is connected.</p>
      )}
    </div>
  );
}
