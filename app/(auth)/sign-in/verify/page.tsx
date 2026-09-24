import { redirect } from "next/navigation";
import { getUser } from "@/lib/orgs";
import { SIGN_IN_PATH, safeNext } from "@/lib/routes";
import { AuthShell } from "../../AuthShell";
import { VerifyForm } from "./VerifyForm";

/** The second step for an account with an authenticator app. */
export default async function VerifyPage({ searchParams }: PageProps<"/sign-in/verify">) {
  const params = await searchParams;
  const from = safeNext(typeof params.from === "string" ? params.from : undefined);
  if (!(await getUser())) redirect(SIGN_IN_PATH);
  return (
    <AuthShell title="Enter your code" lede="Open your authenticator app and enter the 6-digit code for Shulboard.">
      <VerifyForm next={from} />
    </AuthShell>
  );
}
