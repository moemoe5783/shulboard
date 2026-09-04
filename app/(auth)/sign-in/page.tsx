import { redirect } from "next/navigation";
import { SignInForm } from "./SignInForm";
import { getUser } from "@/lib/orgs";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const from = typeof params.from === "string" ? params.from : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  if (isSupabaseConfigured() && (await getUser())) {
    redirect(from && from.startsWith("/") ? from : "/");
  }

  return (
    <main className="bg-paper font-ui flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <h1 className="text-title">Sign in to Shulboard</h1>
        <p className="text-body text-ink-soft mt-1">
          The boards in your shul are managed from here.
        </p>

        <div className="rounded-panel border-rule bg-surface mt-6 border p-6">
          {isSupabaseConfigured() ? (
            <SignInForm from={from} initialError={error} />
          ) : (
            <>
              <h2 className="text-heading">Sign-in isn&rsquo;t configured yet</h2>
              <p className="text-body text-ink-soft mt-1">
                This deployment has no Supabase keys. Set
                NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then
                reload.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
