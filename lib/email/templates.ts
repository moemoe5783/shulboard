import { escapeHtml, type EmailContent } from "./layout.ts";

/*
 * What each email says. Pure data over lib/email/layout.ts.
 *
 * AUTH EMAILS are sent by Supabase Auth, which fills in Go template variables
 * ({{ .RedirectTo }}, {{ .TokenHash }}, …) itself. Their links all go to
 * /auth/confirm, which verifies the token on the server
 * (app/auth/confirm/route.ts). `{{ .RedirectTo }}` is the address the app
 * asked for — always `/auth/confirm?next=…` (app/(auth)/shared.ts), so the
 * token is appended with `&`. scripts/build-emails.ts writes these to
 * supabase/templates/, which config.toml points at; the hosted project takes
 * the same HTML pasted into Dashboard → Authentication → Email Templates.
 *
 * THE INVITE is sent by the app itself (lib/email/send.ts), because an
 * invitation isn't an Auth event: the person may have no account yet, or may
 * already have one.
 */

export type AuthTemplate = { file: string; configKey: string; subject: string; content: EmailContent };

export const AUTH_TEMPLATES: AuthTemplate[] = [
  {
    file: "confirmation.html",
    configKey: "confirmation",
    subject: "Confirm your email for Shulboard",
    content: {
      preheader: "One click to finish setting up your account.",
      heading: "Confirm your email",
      paragraphs: ["Confirm this is your address to finish setting up your Shulboard account."],
      button: { label: "Confirm email", href: "{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email" },
      footnote: "If you didn&#39;t create an account, you can ignore this email and nothing will happen.",
    },
  },
  {
    file: "magic_link.html",
    configKey: "magic_link",
    subject: "Your Shulboard sign-in link",
    content: {
      preheader: "Sign in with one click. The link works once.",
      heading: "Sign in to Shulboard",
      paragraphs: ["Here&#39;s the sign-in link you asked for. It works once and expires in an hour."],
      button: { label: "Sign in", href: "{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email" },
      footnote: "If you didn&#39;t ask to sign in, you can ignore this email. Nobody can sign in without the link.",
    },
  },
  {
    file: "recovery.html",
    configKey: "recovery",
    subject: "Reset your Shulboard password",
    content: {
      preheader: "Choose a new password. The link works once.",
      heading: "Reset your password",
      paragraphs: ["Use this link to choose a new password. It works once and expires in an hour."],
      button: { label: "Choose a new password", href: "{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery" },
      footnote: "If you didn&#39;t ask to reset your password, you can ignore this email. Your password hasn&#39;t changed.",
    },
  },
  {
    file: "email_change.html",
    configKey: "email_change",
    subject: "Confirm your new email for Shulboard",
    content: {
      preheader: "Confirm the change to your sign-in email.",
      heading: "Confirm your new email",
      paragraphs: ["Confirm that you want to sign in to Shulboard with <strong>{{ .NewEmail }}</strong> instead of {{ .Email }}."],
      // Not RedirectTo: the app never starts an email change with one.
      button: { label: "Confirm new email", href: "{{ .SiteURL }}/auth/confirm?next=/account&token_hash={{ .TokenHash }}&type=email_change" },
      footnote: "If you didn&#39;t ask for this, don&#39;t open the link — your account stays on its current email.",
    },
  },
  {
    file: "reauthentication.html",
    configKey: "reauthentication",
    subject: "Your Shulboard confirmation code",
    content: {
      preheader: "Your confirmation code.",
      heading: "Confirm it's you",
      paragraphs: ["Enter this code in Shulboard to continue."],
      code: "{{ .Token }}",
      footnote: "If you didn&#39;t ask for a code, you can ignore this email.",
    },
  },
  {
    file: "invite.html",
    configKey: "invite",
    subject: "You've been invited to Shulboard",
    content: {
      preheader: "Set up your account to help run your shul's screens.",
      heading: "You've been invited to Shulboard",
      paragraphs: ["You&#39;ve been invited to help run the screens in your shul. Set up your account to get started."],
      button: { label: "Set up your account", href: "{{ .SiteURL }}/auth/confirm?next=/auth/new-password&token_hash={{ .TokenHash }}&type=invite" },
      footnote: "If you weren&#39;t expecting this, you can ignore this email.",
    },
  },
];

const ROLE_WORDS: Record<string, string> = {
  admin: "an admin — screens, boards, notices and who's in the shul",
  editor: "an editor — boards, notices and photos",
  viewer: "a viewer — to see what's on the screens",
};

/** The invitation to join a shul. Everything a person typed is escaped. */
export function inviteEmail(input: {
  shulName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresOn: string;
}): { subject: string; content: EmailContent } {
  const shul = escapeHtml(input.shulName);
  const inviter = escapeHtml(input.inviterName);
  return {
    subject: `${input.inviterName} invited you to ${input.shulName} on Shulboard`,
    content: {
      preheader: `Join ${input.shulName} on Shulboard.`,
      heading: `Join ${input.shulName} on Shulboard`,
      paragraphs: [
        `${inviter} has invited you to help run the screens at <strong>${shul}</strong>, as ${escapeHtml(ROLE_WORDS[input.role] ?? input.role)}.`,
        "Open the invitation to join. If you don&#39;t have a Shulboard account yet, you&#39;ll make one on the way — it takes a minute.",
      ],
      button: { label: "Open the invitation", href: input.acceptUrl },
      footnote: `The invitation expires on ${escapeHtml(input.expiresOn)}. If you weren&#39;t expecting it, you can ignore this email.`,
    },
  };
}
