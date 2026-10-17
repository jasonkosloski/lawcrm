/**
 * Client-side parsing of a typed money amount, in lockstep with the
 * server schemas in `src/app/actions/billing.ts` (trust transaction,
 * record payment, send-invoice trust amount): strip every `$` and `,`,
 * then require plain digits with at most two decimals.
 *
 * `parseFloat` is NOT a substitute: `parseFloat("1,200.00")` is 1 and
 * `parseFloat("$500")` is NaN, so a dialog driven by it shows a
 * different amount than the server will record. Returns null when the
 * server would reject the input ("Enter a valid amount"). Zero parses
 * (the server's separate "> 0" check applies on top).
 *
 * Pure and client-safe so dialogs and tests can share it.
 */

const MONEY_SHAPE = /^\d+(\.\d{1,2})?$/;

export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,]/g, "");
  if (!MONEY_SHAPE.test(cleaned)) return null;
  return parseFloat(cleaned);
}
