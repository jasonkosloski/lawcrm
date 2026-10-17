/**
 * Settlement queries — server-only.
 *
 * "At most one settlement per matter" is enforced by a unique index
 * on `Settlement.matterId` (ADR-036). We expose a
 * `getMatterSettlement(matterId)` that returns the settlement on a
 * matter or null, plus the full
 * waterfall computation (gross → firm fee → advanced costs →
 * liens → client net) so the page renders plain numbers.
 */

import { prisma } from "@/lib/prisma";
import { computeSettlementWaterfall } from "@/lib/settlement-waterfall";

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
  /** Attorney fee — `grossAmount * firmFeePercent` (rounded to
   *  cents half-up) when percent is set — including 0% — otherwise
   *  the explicit `firmFee` column. */
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
   *  advanced costs − lien total. Computed fresh on read — the
   *  `Settlement.clientNet` column is never written and is not
   *  used. SIGNED: a negative value is a shortfall (the deductions
   *  exceed the gross) and must be surfaced, never clamped to 0. */
  clientNet: number;
  liens: SettlementLienRow[];
  approvals: SettlementApprovalRow[];
  createdAt: Date;
  updatedAt: Date;
};

export async function getMatterSettlement(
  matterId: string
): Promise<MatterSettlement | null> {
  // `matterId` is unique (one settlement per matter, ADR-036).
  const row = await prisma.settlement.findUnique({
    where: { matterId },
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

  // Exact Decimal math (half-up cents) shared with the action that
  // stores the fee — see src/lib/settlement-waterfall.ts. The
  // percent is the source of truth on most contingency matters; the
  // explicit fee column covers hourly/flat-fee settlements.
  const waterfall = computeSettlementWaterfall({
    grossAmount: row.grossAmount,
    firmFeePercent: row.firmFeePercent,
    firmFee: row.firmFee,
    advancedCosts: row.advancedCosts,
    liens: row.liens.map((l) => ({
      originalAmount: l.originalAmount,
      negotiatedAmount: l.negotiatedAmount,
    })),
  });

  const liens: SettlementLienRow[] = row.liens.map((l, i) => ({
    id: l.id,
    lienholder: l.lienholder,
    lienholderType: l.lienholderType,
    originalAmount: l.originalAmount.toNumber(),
    negotiatedAmount: l.negotiatedAmount?.toNumber() ?? null,
    effectiveAmount: waterfall.lienAmounts[i].toNumber(),
    status: l.status,
  }));

  return {
    id: row.id,
    status: row.status,
    grossAmount: row.grossAmount.toNumber(),
    firmFee: waterfall.firmFee.toNumber(),
    firmFeePercent: row.firmFeePercent?.toNumber() ?? null,
    advancedCosts: row.advancedCosts.toNumber(),
    lienTotal: waterfall.lienTotal.toNumber(),
    clientNet: waterfall.clientNet.toNumber(),
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
