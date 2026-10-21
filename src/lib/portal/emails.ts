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

/** Names no matter, request title, or file. */
export function documentRequestEmail(link: string): Body {
  return {
    subject: "Your legal team has requested documents",
    text: `Your legal team has requested documents from you. Sign in to the client portal to see what is needed:\n\n${link}`,
    html: `<p>Your legal team has requested documents from you. Sign in to the client portal to see what is needed:</p><p><a href="${esc(link)}">Open the client portal</a></p>`,
  };
}

/** Names no matter, request title, or file. */
export function documentsSharedEmail(link: string): Body {
  return {
    subject: "Your legal team shared documents with you",
    text: `Your legal team shared documents with you. Sign in to the client portal to view them:\n\n${link}`,
    html: `<p>Your legal team shared documents with you. Sign in to the client portal to view them:</p><p><a href="${esc(link)}">Open the client portal</a></p>`,
  };
}

/** Names no matter, stage, or update text. */
export function statusUpdateEmail(link: string): Body {
  return {
    subject: "Your legal team posted an update",
    text: `Your legal team posted an update on your case. Sign in to the client portal to read it:\n\n${link}`,
    html: `<p>Your legal team posted an update on your case. Sign in to the client portal to read it:</p><p><a href="${esc(link)}">Open the client portal</a></p>`,
  };
}

/** Names no matter and carries no message text. */
export function portalMessageEmail(link: string): Body {
  return {
    subject: "You have a new message from your legal team",
    text: `You have a new message from your legal team. Sign in to the client portal to read it:\n\n${link}`,
    html: `<p>You have a new message from your legal team. Sign in to the client portal to read it:</p><p><a href="${esc(link)}">Open the client portal</a></p>`,
  };
}

/** Names no matter or amount. */
export function invoicePostedEmail(link: string): Body {
  return {
    subject: "A new invoice is available in your client portal",
    text: `A new invoice is available in your client portal. Sign in to view it:\n\n${link}`,
    html: `<p>A new invoice is available in your client portal. Sign in to view it:</p><p><a href="${esc(link)}">Open the client portal</a></p>`,
  };
}
