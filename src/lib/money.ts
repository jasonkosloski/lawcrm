/**
 * Money rounding. Every computed currency amount that is persisted
 * (hours x rate, line/invoice totals, payments, trust applications)
 * goes through `roundMoney` so a value never carries sub-cent
 * precision into the ledger. Rounding is HALF_UP at 2 decimal places
 * (the standard for invoices: 0.25h x $187.50 = 46.875 -> 46.88).
 *
 * Pure and client-safe (no server-only imports) so forms can share it.
 */

import { Prisma } from "@/generated/prisma/client";

export type MoneyInput = Prisma.Decimal | number | string;

/** Round to whole cents, ROUND_HALF_UP. Accepts a Decimal, number or
 *  numeric string. Throws on a non-numeric string / NaN / Infinity
 *  rather than silently writing garbage into a money column. */
export function roundMoney(value: MoneyInput): Prisma.Decimal {
  const d = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  if (!d.isFinite()) {
    throw new Error("Money value must be a finite number.");
  }
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** True when `value` has at most `places` decimal places. Used to
 *  validate hours precision (2 dp) before multiplying by a rate. */
export function hasAtMostDecimals(
  value: string | number,
  places: number
): boolean {
  let d: Prisma.Decimal;
  try {
    d = new Prisma.Decimal(value);
  } catch {
    return false;
  }
  if (!d.isFinite()) return false;
  return d.decimalPlaces() <= places;
}
