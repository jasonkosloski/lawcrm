/**
 * Settlement waterfall math — gross → firm fee → advanced costs →
 * liens → client net.
 *
 * Pure and exact: every amount is a Prisma.Decimal and every computed
 * figure is rounded to whole cents HALF_UP (ADR-024 `roundMoney`), so
 * the fee the action stores and the fee the read side recomputes can
 * never disagree by a cent. Conversion to JS numbers happens only in
 * the DTO built by `getMatterSettlement`.
 *
 * `clientNet` is deliberately NOT clamped at zero: when fee + costs +
 * liens exceed the gross, the negative figure is the shortfall the
 * firm would have to cover, and hiding it behind a clean $0.00 makes
 * an over-allocated statement look balanced.
 */

import { Prisma } from "@/generated/prisma/client";
import { roundMoney } from "@/lib/money";

/** Firm fee for a percentage fee (`33.33` means 33.33%), rounded to
 *  whole cents HALF_UP. The single source for both the stored column
 *  (upsertSettlement) and the read-side recomputation. */
export function firmFeeFromPercent(
  grossAmount: Prisma.Decimal,
  firmFeePercent: Prisma.Decimal
): Prisma.Decimal {
  return roundMoney(grossAmount.mul(firmFeePercent).div(100));
}

export type WaterfallLienInput = {
  originalAmount: Prisma.Decimal;
  negotiatedAmount: Prisma.Decimal | null;
};

export type WaterfallInput = {
  grossAmount: Prisma.Decimal;
  firmFeePercent: Prisma.Decimal | null;
  /** Stored explicit fee — used only when no percent is set. */
  firmFee: Prisma.Decimal;
  advancedCosts: Prisma.Decimal;
  liens: WaterfallLienInput[];
};

export type Waterfall = {
  firmFee: Prisma.Decimal;
  /** Per-lien payout: negotiated when set (including an explicit 0
   *  write-off), else the original amount. Same order as the input. */
  lienAmounts: Prisma.Decimal[];
  lienTotal: Prisma.Decimal;
  /** Signed; negative = the deductions exceed the gross. */
  clientNet: Prisma.Decimal;
};

export function computeSettlementWaterfall(input: WaterfallInput): Waterfall {
  const firmFee =
    input.firmFeePercent !== null
      ? firmFeeFromPercent(input.grossAmount, input.firmFeePercent)
      : roundMoney(input.firmFee);
  const lienAmounts = input.liens.map((l) =>
    roundMoney(l.negotiatedAmount ?? l.originalAmount)
  );
  const lienTotal = lienAmounts.reduce(
    (sum, a) => sum.add(a),
    new Prisma.Decimal(0)
  );
  const clientNet = roundMoney(
    input.grossAmount
      .sub(firmFee)
      .sub(roundMoney(input.advancedCosts))
      .sub(lienTotal)
  );
  return { firmFee, lienAmounts, lienTotal, clientNet };
}
