import { __setDriverForTests } from "@/lib/email/send";
import type { OutgoingEmail } from "@/lib/email/drivers";

/**
 * Test helper: records outgoing emails in memory instead of sending.
 * Pass `{ fail: "reason" }` to record the message and report a send failure.
 */
export function captureEmails(opts: { fail?: string } = {}): {
  sent: OutgoingEmail[];
  restore(): void;
} {
  const sent: OutgoingEmail[] = [];
  let n = 0;
  __setDriverForTests(async (msg) => {
    sent.push(msg);
    if (opts.fail) return { ok: false, error: opts.fail };
    n += 1;
    return { ok: true, id: `test-${n}` };
  });
  return { sent, restore: () => __setDriverForTests(null) };
}
