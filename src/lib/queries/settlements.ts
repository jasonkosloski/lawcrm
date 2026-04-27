/**
 * Settlement queries — server-only.
 *
 * Today the convention is "at most one settlement per matter" (the
 * schema allows many but in practice contingency matters resolve
 * once). We expose a `getMatterSettlement(matterId)` that returns
 * the latest settlement on a matter or null, plus the full
 * waterfall computation (gross → firm fee → advanced costs →
 * liens → client net) so the page renders plain numbers.
 */

import { prisma } from "@/lib/prisma";

export type SettlementLienRow = {
  id: string;
  lienholder: string;
  lienholderType: string | null;
  originalAmount: number;
  negotiatedAmount: number | null;
  /** What actually gets paid out — negotiated when set, else
   *  original. Drives the lien total in the waterfall math. */
  effectiveAmount: number;
  status: string;
};

export type SettlementApprovalRow = {
  id: string;
  step: number;
  label: string;
  status: string;
  approverId: string | null;
  approverName: string | null;
  approvedAt: Date | null;
  notes: string | null;
};

export type MatterSettlement = {
  id: string;
  status: string;
  /** Gross is what the carrier / opposing side agreed to pay. */
  grossAmount: number;
  /** Attorney fee — `grossAmount * firmFeePercent` when percent
   *  is set, otherwise the explicit `firmFee` column. */
  firmFee: number;
  firmFeePercent: number | null;
  /** Costs the firm advanced on the matter and is being repaid
   *  from the gross. Common on contingency: filing fees,
   *  expert witness costs, deposition transcripts, etc. */
  advancedCosts: number;
  /** Liens (medical providers, subrogation, statutory) — total
   *  pulled out of the gross before the client's net. */
  lienTotal: number;
  /** What the client actually walks away with: gross − fee −
   *  advanced costs − lien total. We compute this fresh on read
   *  rather than trusting `clientNet` because the latter can
   *  drift if a lien gets negotiated and `clientNet` isn't
   *  rewritten. */
  clientNet: number;
  liens: SettlementLienRow[];
  approvals: SettlementApprovalRow[];
  createdAt: Date;
  updatedAt: Date;
};

export async function getMatterSettlement(
  matterId: string
): Promise<MatterSettlement | null> {
  const row = await prisma.settlement.findFirst({
    where: { matterId },
    orderBy: { createdAt: "desc" },
    include: {
      liens: { orderBy: { id: "asc" } },
      approvals: {
        orderBy: { step: "asc" },
        include: {
          approver: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!row) return null;

  const grossAmount = row.grossAmount.toNumber();
  // Compute firmFee from percent when present, else trust the
  // stored fee. firmFeePercent is the source of truth on most
  // contingency matters; the explicit fee column is here for
  // hourly/flat-fee settlements where a percentage doesn't apply.
  const firmFee = row.firmFeePercent
    ? Math.round(grossAmount * row.firmFeePercent.toNumber()) / 100
    : row.firmFee.toNumber();
  const advancedCosts = row.advancedCosts.toNumber();

  const liens: SettlementLienRow[] = row.liens.map((l) => {
    const original = l.originalAmount.toNumber();
    const negotiated = l.negotiatedAmount?.toNumber() ?? null;
    const effective = negotiated ?? original;
    return {
      id: l.id,
      lienholder: l.lienholder,
      lienholderType: l.lienholderType,
      originalAmount: original,
      negotiatedAmount: negotiated,
      effectiveAmount: effective,
      status: l.status,
    };
  });
  const lienTotal = liens.reduce((sum, l) => sum + l.effectiveAmount, 0);

  const clientNet = Math.max(
    0,
    grossAmount - firmFee - advancedCosts - lienTotal
  );

  return {
    id: row.id,
    status: row.status,
    grossAmount,
    firmFee,
    firmFeePercent: row.firmFeePercent?.toNumber() ?? null,
    advancedCosts,
    lienTotal,
    clientNet,
    liens,
    approvals: row.approvals.map((a) => ({
      id: a.id,
      step: a.step,
      label: a.label,
      status: a.status,
      approverId: a.approverId,
      approverName: a.approver?.name ?? null,
      approvedAt: a.approvedAt,
      notes: a.notes,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
