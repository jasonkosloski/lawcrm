import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { livePortalMatterWhere } from "@/lib/portal/status";
import { PORTAL_TIME_ZONE } from "@/lib/portal/time-zone";
import { getInvoiceById, type InvoiceDetail } from "@/lib/queries/billing";
import { dateOnlyKey, todayKey } from "@/lib/format-date";

/**
 * Everything a portal client may see about money lives here (spec:
 * "Visibility"). Base gate: live access + portal on + identity enabled
 * (`livePortalMatterWhere`) AND `Matter.portalBillingEnabled`.
 *  - Invoice: kind "client", status sent/partial/paid, and the identity's
 *    contact is `Invoice.clientId ?? Matter.clientId`.
 *  - Trust: the identity's contact is `Matter.clientId`.
 */

export type PortalInvoiceRow = {
  id: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  status: "sent" | "partial" | "paid";
  overdue: boolean;
};

export type PortalTrustEntry = {
  id: string;
  date: Date;
  type: string;
  amount: number;
  runningBalance: number;
  description: string;
};

const VISIBLE_STATUSES = ["sent", "partial", "paid"];

async function identityContactId(identityId: string): Promise<string | null> {
  const identity = await prisma.portalIdentity.findUnique({
    where: { id: identityId },
    select: { contactId: true },
  });
  return identity?.contactId ?? null;
}

/** Matters the identity may see billing on (base gate), or null. */
async function billingMatterWhere(
  identityId: string,
): Promise<Prisma.MatterWhereInput | null> {
  const live = await livePortalMatterWhere(identityId);
  if (!live) return null;
  return { AND: [live, { portalBillingEnabled: true }] };
}

/** Invoices visible to `contactId`, for matters passing `matterWhere`. */
function visibleInvoiceWhere(
  contactId: string,
  matterWhere: Prisma.MatterWhereInput,
): Prisma.InvoiceWhereInput {
  return {
    kind: "client",
    status: { in: VISIBLE_STATUSES },
    matter: matterWhere,
    OR: [
      { clientId: contactId },
      { clientId: null, matter: { clientId: contactId } },
    ],
  };
}

function isOverdue(status: string, dueDate: Date, today: string): boolean {
  return (
    (status === "sent" || status === "partial") && dateOnlyKey(dueDate) < today
  );
}

export async function listPortalInvoices(
  identityId: string,
  matterId: string,
): Promise<PortalInvoiceRow[]> {
  const matterWhere = await billingMatterWhere(identityId);
  const contactId = await identityContactId(identityId);
  if (!matterWhere || !contactId) return [];
  const rows = await prisma.invoice.findMany({
    where: {
      AND: [
        visibleInvoiceWhere(contactId, matterWhere),
        { matterId },
      ],
    },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  const today = todayKey(PORTAL_TIME_ZONE);
  return rows.map((i) => {
    const balance = i.totalAmount.minus(i.paidAmount);
    return {
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      totalAmount: i.totalAmount.toNumber(),
      paidAmount: i.paidAmount.toNumber(),
      balance: balance.isNegative() ? 0 : balance.toNumber(),
      status: i.status as PortalInvoiceRow["status"],
      overdue: isOverdue(i.status, i.dueDate, today),
    };
  });
}

/** One visibility query, then the staff detail so totals match exactly. */
export async function getPortalInvoice(
  identityId: string,
  invoiceId: string,
): Promise<(InvoiceDetail & { matterId: string }) | null> {
  const matterWhere = await billingMatterWhere(identityId);
  const contactId = await identityContactId(identityId);
  if (!matterWhere || !contactId) return null;
  const visible = await prisma.invoice.findFirst({
    where: { AND: [visibleInvoiceWhere(contactId, matterWhere), { id: invoiceId }] },
    select: { id: true, matterId: true },
  });
  if (!visible) return null;
  const detail = await getInvoiceById(visible.id, PORTAL_TIME_ZONE);
  return detail ? { ...detail, matterId: visible.matterId } : null;
}

/** Trust ledger for the matter's primary client only; null otherwise. */
export async function getPortalTrust(
  identityId: string,
  matterId: string,
): Promise<{ balance: number; entries: PortalTrustEntry[] } | null> {
  const matterWhere = await billingMatterWhere(identityId);
  const contactId = await identityContactId(identityId);
  if (!matterWhere || !contactId) return null;
  const matter = await prisma.matter.findFirst({
    where: { AND: [matterWhere, { id: matterId, clientId: contactId }] },
    // Same source as the staff billing tab (`getMatterBilling`).
    select: { trustBalance: true },
  });
  if (!matter) return null;
  const txns = await prisma.trustTransaction.findMany({
    where: { matterId },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  let running = new Prisma.Decimal(0);
  const entries: PortalTrustEntry[] = txns.map((t) => {
    running = running.plus(t.amount);
    return {
      id: t.id,
      date: t.date,
      type: t.type,
      amount: t.amount.toNumber(),
      runningBalance: running.toNumber(),
      description: t.description,
    };
  });
  return { balance: matter.trustBalance.toNumber(), entries: entries.reverse() };
}

/** Can the identity see any money on this matter (trust or an invoice)? */
export async function canSeePortalBilling(
  identityId: string,
  matterId: string,
): Promise<boolean> {
  if (await getPortalTrust(identityId, matterId)) return true;
  const matterWhere = await billingMatterWhere(identityId);
  const contactId = await identityContactId(identityId);
  if (!matterWhere || !contactId) return false;
  const hit = await prisma.invoice.findFirst({
    where: { AND: [visibleInvoiceWhere(contactId, matterWhere), { matterId }] },
    select: { id: true },
  });
  return hit !== null;
}

/** Unpaid visible-invoice balances per matter (only matters owing > 0). */
export async function portalBalanceDueByMatter(
  identityId: string,
  matterIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (matterIds.length === 0) return out;
  const matterWhere = await billingMatterWhere(identityId);
  const contactId = await identityContactId(identityId);
  if (!matterWhere || !contactId) return out;
  const rows = await prisma.invoice.findMany({
    where: {
      AND: [
        visibleInvoiceWhere(contactId, matterWhere),
        { matterId: { in: matterIds }, status: { in: ["sent", "partial"] } },
      ],
    },
    select: { matterId: true, totalAmount: true, paidAmount: true },
  });
  const sums = new Map<string, Prisma.Decimal>();
  for (const r of rows) {
    const bal = r.totalAmount.minus(r.paidAmount);
    if (!bal.isPositive() || bal.isZero()) continue;
    sums.set(r.matterId, (sums.get(r.matterId) ?? new Prisma.Decimal(0)).plus(bal));
  }
  for (const [id, sum] of sums) out.set(id, sum.toNumber());
  return out;
}
