/**
 * Staff-side portal billing queries. Called by the billing page and the
 * send action AFTER their own billing.view / matter-access gates; nothing
 * here authenticates. The client-facing reader lives in
 * `src/lib/portal/billing.ts`.
 */

import { prisma } from "@/lib/prisma";

export type PortalSendAvailability = {
  available: boolean;
  reason: string | null;
};

export const PORTAL_OFF_REASON = "The client portal is turned off.";
export const PORTAL_SWITCH_OFF_REASON =
  "Turn on 'Show billing in the portal' for this matter first.";
export const PORTAL_NO_ACCESS_REASON =
  "The billed client doesn't have portal access to this matter.";

type Target = { available: true; email: string } | { available: false; reason: string };

/**
 * Who a portal-posted invoice would notify: the live portal identity of the
 * billed contact (`Invoice.clientId ?? Matter.clientId`) with non-revoked
 * access on the invoice's matter. Unavailable when the firm portal or the
 * matter's billing switch is off.
 */
export async function resolvePortalSendTarget(invoiceId: string): Promise<Target> {
  const [firm, invoice] = await Promise.all([
    prisma.firm.findFirst({ select: { portalEnabled: true } }),
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        clientId: true,
        matterId: true,
        matter: { select: { clientId: true, portalBillingEnabled: true } },
      },
    }),
  ]);
  if (!firm?.portalEnabled) {
    return { available: false, reason: PORTAL_OFF_REASON };
  }
  if (!invoice) return { available: false, reason: "Invoice not found." };
  if (!invoice.matter.portalBillingEnabled) {
    return { available: false, reason: PORTAL_SWITCH_OFF_REASON };
  }
  const billedContactId = invoice.clientId ?? invoice.matter.clientId;
  if (!billedContactId) {
    return { available: false, reason: PORTAL_NO_ACCESS_REASON };
  }
  const identity = await prisma.portalIdentity.findFirst({
    where: {
      contactId: billedContactId,
      disabledAt: null,
      access: { some: { matterId: invoice.matterId, revokedAt: null } },
    },
    select: { email: true },
  });
  if (!identity) return { available: false, reason: PORTAL_NO_ACCESS_REASON };
  return { available: true, email: identity.email };
}

export async function portalSendAvailability(invoiceId: string): Promise<PortalSendAvailability> {
  const t = await resolvePortalSendTarget(invoiceId);
  return t.available ? { available: true, reason: null } : { available: false, reason: t.reason };
}
