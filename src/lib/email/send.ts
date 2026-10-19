import "server-only";
import {
  consoleDriver,
  notConfiguredDriver,
  resendDriver,
  type EmailDriver,
  type EmailResult,
  type OutgoingEmail,
} from "./drivers";

export type { OutgoingEmail };

let testDriver: EmailDriver | null = null;

/**
 * TEST ONLY: swap in an in-memory driver (null restores normal selection).
 * Use via `captureEmails()` in src/test/email-capture.ts, not directly.
 */
export function __setDriverForTests(driver: EmailDriver | null): void {
  testDriver = driver;
}

function pickDriver(): EmailDriver {
  if (testDriver) return testDriver;
  const key = process.env.RESEND_API_KEY?.trim();
  if (key) return resendDriver(key);
  // The console driver prints message bodies (including sign-in links); never in production.
  if (process.env.NODE_ENV === "production") return notConfiguredDriver;
  return consoleDriver;
}

/** Sends one email. RESEND_API_KEY set -> Resend, otherwise console log. Never throws. */
export async function sendEmail(msg: OutgoingEmail): Promise<EmailResult> {
  try {
    return await pickDriver()(msg);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
