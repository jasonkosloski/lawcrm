/**
 * Shared helpers for the billing server actions (not actions
 * themselves — this module has no "use server" directive, so nothing
 * here is callable from the client).
 */

import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/prisma";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
// Date-only inputs ("YYYY-MM-DD") are stored at UTC midnight and read
// in UTC (ADR-012). "Today" is the user's calendar day in their
// profile zone, never the server's.
import { parseDateOnly, todayKey } from "@/lib/format-date";
import { roundMoney } from "@/lib/money";
import { UserFacingError } from "@/lib/user-facing-error";
import { TIME_ENTRY_WIP_STATUSES } from "@/lib/constants/time-entry-status";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Today's calendar date for the acting user, stored the date-only
 *  way (UTC midnight of their local day — ADR-012). The blank-date
 *  fallback for payments and trust transactions; never `new Date()`,
 *  which is already tomorrow on a UTC host after 6 pm Denver. */
export async function todayDateOnly(): Promise<Date> {
  const tz = await getCurrentUserTimeZone();
  return parseDateOnly(todayKey(tz))!;
}

/** The calendar year used in invoice numbers: the acting user's
 *  current year, so a generate at 6 pm Denver on Dec 31 is still
 *  numbered in the old year even though the UTC server is in January. */
export async function invoiceNumberYear(): Promise<string> {
  const tz = await getCurrentUserTimeZone();
  return todayKey(tz).slice(0, 4);
}

/** "3 time entries + 2 expenses" — the composition line shared by
 *  the audit entries of generate and bundle. */
export function describeBundle(entryCount: number, expenseCount: number): string {
  const parts: string[] = [];
  if (entryCount > 0) {
    parts.push(`${entryCount} time ${entryCount === 1 ? "entry" : "entries"}`);
  }
  if (expenseCount > 0) {
    parts.push(`${expenseCount} expense${expenseCount === 1 ? "" : "s"}`);
  }
  return parts.join(" + ");
}

/** Generate the next invoice number for `year`.
 *  Format: "YYYY-NNN" (e.g. 2026-007). Counts existing invoices
 *  whose number starts with the year prefix (max + 1, so deleting the
 *  newest never-sent DRAFT hands its number to the next generate —
 *  intentional: it keeps the sequence gap-free, and a draft never
 *  reached a client). Race condition path:
 *  if two concurrent generates land on the same number, the
 *  unique-index on Invoice.invoiceNumber rejects the second. The
 *  caller then retries by re-running its WHOLE transaction — a
 *  failed INSERT aborts the Postgres transaction (SQLSTATE 25P02),
 *  so a retry inside the same transaction can never succeed. */
export async function nextInvoiceNumber(
  tx: Tx,
  year: string
): Promise<string> {
  const prefix = `${year}-`;
  // MAX over the leading digits of the suffix, computed in the DB so
  // the year's invoices are never loaded. Non-numeric (hand-crafted)
  // suffixes are ignored; at most 9 digits so the cast can't overflow.
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(
      CAST(substring(substring("invoiceNumber" from ${prefix.length + 1}::int) from '^[0-9]{1,9}') AS integer)
    ) AS max
    FROM invoices
    WHERE left("invoiceNumber", ${prefix.length}::int) = ${prefix}`;
  const max = rows[0]?.max ?? 0;
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** Max whole-transaction attempts when concurrent mints collide on the
 *  invoice-number unique index. */
export const INVOICE_NUMBER_ATTEMPTS = 5;

/** Run `mint` (a function that opens a NEW transaction each call),
 *  re-running it on an invoice-number unique violation (P2002) up to
 *  INVOICE_NUMBER_ATTEMPTS times. Each run recomputes the number from
 *  committed rows. Generate locks are per-matter, so concurrent mints
 *  on different matters can race for the same number repeatedly. */
export async function retryOnInvoiceNumberCollision<T>(
  mint: () => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await mint();
    } catch (err) {
      const collided =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002";
      if (!collided || attempt >= INVOICE_NUMBER_ATTEMPTS) throw err;
    }
  }
}

/** Mutation helper — adjusts a matter's trustBalance by the signed
 *  delta. Decimal-safe; refuses to overdraw. Caller is expected to
 *  also create the underlying TrustTransaction row. */
export async function adjustTrustBalance(
  tx: Tx,
  matterId: string,
  deltaDecimal: Prisma.Decimal
): Promise<{ ok: boolean; error?: string }> {
  // Row-lock the matter before reading: the read-check-write on
  // trustBalance is a lost-update hazard under READ COMMITTED —
  // two concurrent disbursements would both pass the overdraw
  // check and the second write would clobber the first. FOR UPDATE
  // queues the competitor until this transaction commits, so it
  // re-reads the already-adjusted balance.
  await tx.$queryRaw`SELECT id FROM matters WHERE id = ${matterId} FOR UPDATE`;
  const m = await tx.matter.findUnique({
    where: { id: matterId },
    select: { trustBalance: true },
  });
  if (!m) return { ok: false, error: "Matter not found" };
  const next = roundMoney(m.trustBalance.add(deltaDecimal));
  if (next.isNegative()) {
    return {
      ok: false,
      error: `Trust would overdraw — current balance is $${m.trustBalance.toFixed(2)}, attempted change ${deltaDecimal.toFixed(2)}.`,
    };
  }
  await tx.matter.update({
    where: { id: matterId },
    data: { trustBalance: next },
  });
  return { ok: true };
}

/** Lock the matter row and return its current trust balance. The
 *  read-check-write on trustBalance is a lost-update hazard under
 *  READ COMMITTED; FOR UPDATE queues a competing disbursement until
 *  this transaction commits. Lock order is invoice → matter
 *  everywhere an invoice is involved, so deadlocks are impossible. */
export async function lockMatterTrustBalance(
  tx: Tx,
  matterId: string
): Promise<Prisma.Decimal> {
  await tx.$queryRaw`SELECT id FROM matters WHERE id = ${matterId} FOR UPDATE`;
  const matter = await tx.matter.findUnique({
    where: { id: matterId },
    select: { trustBalance: true },
  });
  if (!matter) throw new UserFacingError("Matter not found.");
  return matter.trustBalance;
}

/** The trust leg of paying an invoice from trust — the ONE copy used
 *  by recordInvoicePayment (source=trust) and sendInvoice (apply
 *  trust): a disbursement TrustTransaction linked to the invoice, the
 *  Matter.trustBalance decrement, and the InvoicePayment pointing back
 *  at the ledger row. The caller must hold the invoice and matter row
 *  locks, have read `trustBalance` via lockMatterTrustBalance, and
 *  have already checked the amount against the balance (the refusal
 *  wording differs per caller). Returns the TrustTransaction id. */
export async function payInvoiceFromTrust(
  tx: Tx,
  args: {
    invoice: { id: string; matterId: string; invoiceNumber: string };
    trustBalance: Prisma.Decimal;
    amount: Prisma.Decimal;
    date: Date;
    reference: string | null;
    paymentDescription: string | null;
    userId: string;
  }
): Promise<string> {
  const { invoice, amount } = args;
  const trustTxn = await tx.trustTransaction.create({
    data: {
      matterId: invoice.matterId,
      type: "disbursement",
      amount: amount.neg(),
      description: `Payment to invoice ${invoice.invoiceNumber}`,
      reference: args.reference,
      date: args.date,
      createdBy: args.userId,
      invoiceId: invoice.id,
    },
    select: { id: true },
  });
  await tx.matter.update({
    where: { id: invoice.matterId },
    data: { trustBalance: roundMoney(args.trustBalance.sub(amount)) },
  });
  await tx.invoicePayment.create({
    data: {
      invoiceId: invoice.id,
      source: "trust",
      amount,
      date: args.date,
      description: args.paymentDescription,
      reference: args.reference,
      trustTxnId: trustTxn.id,
      createdBy: args.userId,
    },
  });
  return trustTxn.id;
}

/** Sum of per-line amounts, each rounded to cents first (invoice
 *  convention: total = sum of the lines as printed). Null amounts
 *  (unpriced / contingent lines) contribute nothing. */
export function sumLineAmounts(
  amounts: ReadonlyArray<Prisma.Decimal | null>
): Prisma.Decimal {
  return amounts.reduce<Prisma.Decimal>(
    (acc, a) => (a ? acc.add(roundMoney(a)) : acc),
    new Prisma.Decimal(0)
  );
}

/** Link the WIP rows an invoice was computed from. Each updateMany is
 *  predicated on the row still being unbilled (`invoiceId: null`, and
 *  a WIP status for time entries); if fewer rows move than were read
 *  (a concurrent generate got there first) the transaction aborts so
 *  the invoice total can never disagree with its line items. */
export async function linkWipToInvoice(
  tx: Tx,
  invoiceId: string,
  entries: ReadonlyArray<{ id: string }>,
  expenseRows: ReadonlyArray<{ id: string }>
): Promise<void> {
  const changed = new UserFacingError(
    "Billable time or expenses changed while the invoice was being created — refresh and try again."
  );
  if (entries.length > 0) {
    const res = await tx.timeEntry.updateMany({
      where: {
        id: { in: entries.map((e) => e.id) },
        invoiceId: null,
        status: { in: [...TIME_ENTRY_WIP_STATUSES] },
      },
      data: { invoiceId, status: "billed" },
    });
    if (res.count !== entries.length) throw changed;
  }
  // Expenses don't have a status enum like time entries — the
  // `invoiceId` itself is the "billed" signal.
  if (expenseRows.length > 0) {
    const res = await tx.expense.updateMany({
      where: { id: { in: expenseRows.map((e) => e.id) }, invoiceId: null },
      data: { invoiceId },
    });
    if (res.count !== expenseRows.length) throw changed;
  }
}

/** Refusal for approving / sending a client invoice that totals $0:
 *  every new invoice starts unpriced (only the line-item editor sets a
 *  rate), and a $0 invoice would "pay itself" on send and lock its
 *  time entries to a dead-end `paid` row. */
export const ZERO_TOTAL_ERROR =
  "This invoice totals $0.00 — price the line items before approving or sending it. Delete the draft if there is nothing to bill.";
