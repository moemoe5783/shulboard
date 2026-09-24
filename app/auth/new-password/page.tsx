import Link from "next/link";
import { AuthShell } from "@/app/(auth)/AuthShell";
import { getUser } from "@/lib/orgs";
import { FORGOT_PASSWORD_PATH, safeNext } from "@/lib/routes";
import { NewPasswordForm } from "./NewPasswordForm";

/**
 * Choosing a new password. Reached from a reset link, which has already signed
 * the person in (app/auth/confirm/route.ts), or from Account settings.
 */
export default async function NewPasswordPage({ searchParams }: PageProps<"/auth/new-password">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  const user = await getUser();

  if (!user) {
    return (
      <AuthShell title="Choose a new password">
        <p className="text-body">
          This page needs the link from your reset email. It may have expired.{" "}
          <Link href={FORGOT_PASSWORD_PATH} className="text-verdigris">
            Ask for a new link
          </Link>
          .
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" lede={`For ${user.email}.`}>
      <NewPasswordForm next={next} />
    </AuthShell>
  );
}
