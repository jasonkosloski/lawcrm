import "server-only";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailResult = { ok: true } | { ok: false; error: string };
export type EmailDriver = (msg: OutgoingEmail) => Promise<EmailResult>;

/** Dev/default driver: logs the message (including any links) to the console. */
export const consoleDriver: EmailDriver = async (msg) => {
  console.info(
    `[email:console] to=${msg.to} subject=${msg.subject}\n${msg.text}`,
  );
  return { ok: true };
};

/** Resend driver: plain fetch, no SDK. Never throws. */
export function resendDriver(apiKey: string): EmailDriver {
  return async (msg) => {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        }),
      });
      if (!res.ok) return { ok: false, error: `Resend responded ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "send failed" };
    }
  };
}
