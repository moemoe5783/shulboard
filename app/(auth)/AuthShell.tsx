import type { ReactNode } from "react";

/** The frame every sign-in page shares: a title, a line under it, one card. */
export function AuthShell({ title, lede, children }: { title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <main className="bg-paper font-ui flex min-h-screen items-center justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-md">
        <h1 className="text-title">{title}</h1>
        {lede && <p className="text-body text-ink-soft mt-1">{lede}</p>}
        <div className="rounded-panel border-rule bg-surface mt-6 border p-5 sm:p-6">{children}</div>
      </div>
    </main>
  );
}
