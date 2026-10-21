import "server-only";

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  fromName?: string;
  attachments?: EmailAttachment[];
};

export type EmailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };
export type EmailDriver = (msg: OutgoingEmail) => Promise<EmailResult>;

/** Dev/default driver: logs the message (including any links) to the console. */
export const consoleDriver: EmailDriver = async (msg) => {
  const files = msg.attachments?.length
    ? `\nattachments: ${msg.attachments
        .map((a) => `${a.filename} (${a.content.length} bytes)`)
        .join(", ")}`
    : "";
  console.info(
    `[email:console] to=${msg.to} subject=${msg.subject}\n${msg.text}${files}`,
  );
  return { ok: true };
};

/** Production without a provider: refuse, and log nothing about the message. */
export const notConfiguredDriver: EmailDriver = async () => ({
  ok: false,
  error: "Email is not configured.",
});

/** Resend driver: plain fetch, no SDK. Never throws. */
export function resendDriver(apiKey: string): EmailDriver {
  return async (msg) => {
    const from = process.env.EMAIL_FROM?.trim();
    if (!from) return { ok: false, error: "EMAIL_FROM is not set." };
    const address = /<([^>]+)>/.exec(from)?.[1]?.trim() ?? from;
    const displayName = msg.fromName?.replace(/[\r\n]+/g, " ").trim();
    const fromHeader = displayName
      ? `"${displayName.replace(/[\\"]/g, "\\$&")}" <${address}>`
      : from;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          from: fromHeader,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
          ...(msg.attachments?.length
            ? {
                attachments: msg.attachments.map((a) => ({
                  filename: a.filename,
                  content: a.content.toString("base64"),
                  ...(a.contentType ? { content_type: a.contentType } : {}),
                })),
              }
            : {}),
        }),
      });
      if (!res.ok) return { ok: false, error: `Resend responded ${res.status}` };
      let id: string | undefined;
      try {
        const json = (await res.json()) as { id?: unknown };
        if (typeof json?.id === "string") id = json.id;
      } catch {
        // body is optional; the send already succeeded
      }
      return { ok: true, id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "send failed" };
    }
  };
}
