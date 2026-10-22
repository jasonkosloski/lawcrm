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
export function hasAtMostDecimals(value: string | number, places: number): boolean {
  let d: Prisma.Decimal;
  try {
    d = new Prisma.Decimal(value);
  } catch {
    return false;
  }
  if (!d.isFinite()) return false;
  return d.decimalPlaces() <= places;
}

/** Largest value a DECIMAL(14,2) money column can hold. */
export const MAX_MONEY_AMOUNT = "999999999999.99";

/** True when `value` (a non-negative numeric string already shaped
 *  `\d+(\.\d{1,2})?`) fits a DECIMAL(14,2) column. Compared as Decimals,
 *  not floats, so the ceiling is exact. Form validators use this to
 *  return a field error instead of letting Prisma throw on write. */
export function fitsMoneyColumn(value: string): boolean {
  try {
    return new Prisma.Decimal(value).lte(MAX_MONEY_AMOUNT);
  } catch {
    return false;
  }
}

export const MONEY_TOO_LARGE_MESSAGE = "Amount is too large";
