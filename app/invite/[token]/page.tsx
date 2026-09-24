import Link from "next/link";
import { AuthShell } from "@/app/(auth)/AuthShell";
import { buttonClassName } from "@/components/Button";
import { getUser } from "@/lib/orgs";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/routes";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { switchAccount } from "./actions";
import { JoinButton } from "./JoinButton";

/*
 * Where an invitation email's link lands. Public (lib/supabase/proxy.ts): the
 * invitee may have no account yet, and should see who's inviting them to what
 * before they make one. invite_preview shows the invite to whoever holds its
 * token and nothing else.
 */

export const dynamic = "force-dynamic";

const ROLE_WORDS: Record<string, string> = {
  admin: "an admin",
  editor: "an editor",
  viewer: "a viewer",
};

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  if (!isSupabaseConfigured()) {
    return (
      <AuthShell title="Invitation">
        <p className="text-body">Sign-in isn&rsquo;t configured on this deployment yet.</p>
      </AuthShell>
    );
  }

  const supabase = await createClient();
  const [{ data: rows }, user] = await Promise.all([supabase.rpc("invite_preview", { p_token: token }), getUser()]);
  const invite = rows?.[0];
  const here = `/invite/${token}`;

  if (!invite) {
    return (
      <AuthShell title="This invitation link doesn't work">
        <p className="text-body">Check that the whole link was copied, or ask the person who invited you for a new one.</p>
      </AuthShell>
    );
  }

  if (invite.status !== "pending") {
    const why =
      invite.status === "expired"
        ? "This invitation has expired."
        : invite.status === "revoked"
          ? "This invitation was withdrawn."
          : "This invitation has already been used.";
    return (
      <AuthShell title={`Join ${invite.org_name}`}>
        <p className="text-body">
          {why} Ask {invite.invited_by_name ?? "the person who invited you"} for a new one.
        </p>
        {user && (
          <p className="text-body mt-4">
            <Link href="/" className="text-verdigris">
              Go to your dashboard
            </Link>
          </p>
        )}
      </AuthShell>
    );
  }

  const lede = `${invite.invited_by_name ?? "Someone"} invited ${invite.email} to help run the screens at ${invite.org_name}, as ${ROLE_WORDS[invite.role] ?? invite.role}.`;

  if (!user) {
    const query = new URLSearchParams({ from: here, email: invite.email });
    return (
      <AuthShell title={`Join ${invite.org_name}`} lede={lede}>
        <p className="text-body">Create an account with {invite.email} to join, or sign in if you already have one.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`${SIGN_UP_PATH}?${query}`} className={buttonClassName("primary")}>
            Create an account
          </Link>
          <Link href={`${SIGN_IN_PATH}?${query}`} className={buttonClassName("secondary")}>
            Sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  if ((user.email ?? "").toLowerCase() !== invite.email) {
    return (
      <AuthShell title={`Join ${invite.org_name}`} lede={lede}>
        <p className="text-body">
          You&rsquo;re signed in as {user.email}, but this invitation is for {invite.email}. Sign in with {invite.email}{" "}
          to join, or ask for an invitation to {user.email} instead.
        </p>
        <form action={switchAccount} className="mt-4">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="email" value={invite.email} />
          <button type="submit" className={buttonClassName("primary")}>
            Sign in as {invite.email}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={`Join ${invite.org_name}`} lede={lede}>
      <JoinButton token={token} shulName={invite.org_name} />
    </AuthShell>
  );
}
