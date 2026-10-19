import type { OutgoingEmail } from "@/lib/email/drivers";

type Body = Omit<OutgoingEmail, "to">;

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Sign-in email. Deliberately names no matter. */
export function loginEmail(link: string): Body {
  return {
    subject: "Your sign-in link",
    text: `Use this link to sign in to the client portal:\n\n${link}\n\nIt works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.`,
    html: `<p>Use this link to sign in to the client portal:</p><p><a href="${esc(link)}">Sign in</a></p><p>It works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.</p>`,
  };
}

/** First-time invitation. Names the firm and the matter being shared. */
export function inviteEmail(
  link: string,
  firmName: string,
  matterName: string
): Body {
  return {
    subject: `${firmName} invited you to the client portal`,
    text: `${firmName} has given you access to the client portal for: ${matterName}.\n\nUse this link to get started:\n\n${link}\n\nIt works once and expires in 7 days.`,
    html: `<p>${esc(firmName)} has given you access to the client portal for: ${esc(matterName)}.</p><p><a href="${esc(link)}">Get started</a></p><p>It works once and expires in 7 days.</p>`,
  };
}
