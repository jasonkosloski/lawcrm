import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";
import type { OutgoingEmail } from "@/lib/email/drivers";

/**
 * Emails every live portal user on a matter once: identity not
 * disabled, access on this matter not revoked. Sends nothing when the
 * firm portal is off. Never throws on a delivery failure; it counts it.
 */
export async function emailLivePortalUsers(
  matterId: string,
  body: Omit<OutgoingEmail, "to">,
): Promise<{ sent: number; failed: number }> {
  const firm = await prisma.firm.findFirst({ select: { portalEnabled: true } });
  if (!firm?.portalEnabled) return { sent: 0, failed: 0 };
  const identities = await prisma.portalIdentity.findMany({
    where: {
      disabledAt: null,
      access: { some: { matterId, revokedAt: null } },
    },
    select: { email: true },
  });
  const emails = [...new Set(identities.map((i) => i.email))];
  let sent = 0;
  let failed = 0;
  for (const to of emails) {
    try {
      const res = await sendEmail({ to, ...body });
      if (res.ok) sent++;
      else failed++;
    } catch (err) {
      console.warn("[portal-notify] email failed", err);
      failed++;
    }
  }
  return { sent, failed };
}
