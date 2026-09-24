import { redirect } from "next/navigation";
import { getUser } from "@/lib/orgs";
import { safeNext } from "@/lib/routes";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { AuthShell } from "../AuthShell";
import { SignUpForm } from "./SignUpForm";

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const params = await searchParams;
  const from = typeof params.from === "string" ? params.from : undefined;
  const email = typeof params.email === "string" ? params.email : "";

  if (isSupabaseConfigured() && (await getUser())) redirect(safeNext(from));

  return (
    <AuthShell title="Create your account" lede="One account for every shul you help run.">
      <SignUpForm from={from} initialEmail={email} />
    </AuthShell>
  );
}
