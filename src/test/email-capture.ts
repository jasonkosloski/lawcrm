import { __setDriverForTests } from "@/lib/email/send";
import type { OutgoingEmail } from "@/lib/email/drivers";

/** Test helper: records outgoing emails in memory instead of sending. */
export function captureEmails(): { sent: OutgoingEmail[]; restore(): void } {
  const sent: OutgoingEmail[] = [];
  __setDriverForTests(async (msg) => {
    sent.push(msg);
    return { ok: true };
  });
  return { sent, restore: () => __setDriverForTests(null) };
}
