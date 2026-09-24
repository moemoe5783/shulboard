import Link from "next/link";
import { buttonClassName } from "@/components/Button";
import { requireUser } from "@/lib/orgs";
import { NEW_PASSWORD_PATH } from "@/lib/routes";
import { ProfileForm } from "./ProfileForm";
import { TwoStepSettings } from "./TwoStepSettings";

/*
 * Your own account — separate from the shul's Settings, because it follows you
 * to every shul you help run. Name, password, and two-step sign-in.
 */

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const hasPassword = (user.identities ?? []).some((identity) => identity.provider === "email");

  return (
    <div className="max-w-3xl">
      <h1 className="text-title">Account</h1>
      <p className="text-body text-ink-soft mt-1">Signed in as {user.email}. This follows you to every shul you help run.</p>

      <section className="rounded-panel border-rule bg-surface mt-6 border p-4 sm:p-6">
        <h2 className="text-heading">Your name</h2>
        <p className="text-meta text-ink-soft mt-1">Shown to the other people in your shul.</p>
        <div className="mt-4">
          <ProfileForm name={name} />
        </div>
      </section>

      <section className="rounded-panel border-rule bg-surface mt-6 border p-4 sm:p-6">
        <h2 className="text-heading">Password</h2>
        <p className="text-body text-ink-soft mt-1">
          {hasPassword
            ? "Change the password you sign in with."
            : "You sign in with Google or an emailed link. Set a password to sign in with it as well."}
        </p>
        <div className="mt-4">
          <Link href={`${NEW_PASSWORD_PATH}?next=/account`} className={buttonClassName("secondary")}>
            {hasPassword ? "Change password" : "Set a password"}
          </Link>
        </div>
      </section>

      <section className="rounded-panel border-rule bg-surface mt-6 border p-4 sm:p-6">
        <h2 className="text-heading">Two-step sign-in</h2>
        <p className="text-body text-ink-soft mt-1">
          Ask for a code from an authenticator app — Google Authenticator, Microsoft Authenticator, 1Password — every
          time you sign in, so a stolen password isn&rsquo;t enough.
        </p>
        <div className="mt-4">
          <TwoStepSettings />
        </div>
      </section>
    </div>
  );
}
