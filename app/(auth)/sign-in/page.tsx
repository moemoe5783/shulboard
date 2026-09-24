import { redirect } from "next/navigation";
import { AuthShell } from "../AuthShell";
import { SignInForm } from "./SignInForm";
import { getUser } from "@/lib/orgs";
import { safeNext } from "@/lib/routes";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const from = typeof params.from === "string" ? params.from : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  const email = typeof params.email === "string" ? params.email : "";

  if (isSupabaseConfigured() && (await getUser())) {
    redirect(safeNext(from));
  }

  return (
    <AuthShell title="Sign in to Shulboard" lede="The boards in your shul are managed from here.">
      {/* SignInForm reports an unusable configuration itself. It reads the
          values that were inlined into this bundle at build time, which are
          the ones the sign-in call will actually use — the server's view of
          process.env can differ and would mislead. */}
      <SignInForm from={from} initialEmail={email} initialError={error} />
    </AuthShell>
  );
}
