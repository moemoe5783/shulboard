import "server-only";

import { EMAIL_COLORS } from "./colors.generated";
import { emailHtml, emailText, type EmailContent } from "./layout";

/*
 * Sending the emails the app sends itself — today, invitations. (Account
 * emails — confirm, reset, sign-in links — are sent by Supabase Auth through
 * the same Resend account, over SMTP: supabase/config.toml.)
 *
 * Resend's HTTP API, one request, no SDK. Two environment variables
 * (docs/environment.md): RESEND_API_KEY, a secret, and EMAIL_FROM_ADDRESS, an
 * address on a domain verified in Resend. Never throws: a failure comes back
 * as a sentence the invite form shows, and the invitation still exists with a
 * link that can be copied and sent by hand.
 */

export type SendOutcome = { sent: true } | { sent: false; reason: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM_ADDRESS);
}

export async function sendEmail(input: { to: string; subject: string; content: EmailContent }): Promise<SendOutcome> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;
  if (!key || !from) {
    return { sent: false, reason: "Email isn't set up on this deployment." };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Shulboard <${from}>`,
        to: [input.to],
        subject: input.subject,
        html: emailHtml(input.content, EMAIL_COLORS),
        text: emailText(input.content),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { sent: true };
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return { sent: false, reason: `The email service refused it (${response.status}${body?.message ? `: ${body.message}` : ""}).` };
  } catch (error) {
    return { sent: false, reason: `The email service couldn't be reached (${error instanceof Error ? error.message : String(error)}).` };
  }
}
