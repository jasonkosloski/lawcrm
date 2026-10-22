/**
 * Money display formatter.
 *
 * One `Intl.NumberFormat`-backed formatter so every surface renders
 * `$1,234.50` the same way and negatives read `-$50.25` (sign before
 * the symbol — the old `$${n.toLocaleString()}` copies produced
 * `$-50.25` and dropped trailing zeros).
 *
 * Display only: money is stored and computed as Decimal (see
 * `roundMoney` in money.ts). Pass `{ cents: false }` for the
 * whole-dollar dashboards and reports.
 */

const WITH_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const WHOLE_DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatMoney(n: number, opts: { cents?: boolean } = {}): string {
  const formatter = opts.cents === false ? WHOLE_DOLLARS : WITH_CENTS;
  // Intl renders -0 as "-$0.00"; normalize so a zeroed balance never
  // shows a sign.
  return formatter.format(Object.is(n, -0) ? 0 : n);
}
