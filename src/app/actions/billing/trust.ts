/**
 * Billing action: manual trust-ledger transactions (deposit /
 * disbursement / refund).
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertMatterAccess } from "@/lib/matter-access";
import { getCurrentUserId } from "@/lib/current-user";
// Date-only inputs ("YYYY-MM-DD") are stored at UTC midnight and read
// in UTC (ADR-012). "Today" is the user's calendar day in their
// profile zone, never the server's.
import { parseDateOnly } from "@/lib/format-date";
import { requirePermission } from "@/lib/permission-check";
import { logActivity } from "@/lib/activity-log";
import { roundMoney } from "@/lib/money";
import { UserFacingError, toUserMessage } from "@/lib/user-facing-error";
import { TRUST_TXN_TYPES, billingInitialState, type BillingFormState } from "@/lib/billing-form";
import { todayDateOnly, adjustTrustBalance } from "./helpers";

// ── Trust ledger ────────────────────────────────────────────────────────

const trustTxnSchema = z.object({
  type: z.enum(TRUST_TXN_TYPES),
  /** Form posts a string — accept "$1,234.56" or "1234.56" and
   *  validate ≥ 0.01. Sign is applied by `type` (deposit positive,
   *  disbursement / refund negative). */
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .transform((v) => v.replace(/[$,]/g, ""))
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter a valid amount")
    .refine((v) => parseFloat(v) > 0, "Amount must be greater than 0"),
  description: z.string().trim().min(1, "Description is required").max(400),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
  /** YYYY-MM-DD from <input type="date">. Defaults to today when
   *  empty. */
  date: z.string().optional().or(z.literal("")),
});

export async function addTrustTransaction(
  matterId: string,
  _prev: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  await requirePermission("trust.record_transaction");
  await assertMatterAccess(matterId);
  const userId = await getCurrentUserId();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = trustTxnSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;
  const positive = roundMoney(data.amount);
  // Disbursement / refund are stored as negative amounts so trust
  // sums match the balance directly. Deposits stay positive.
  const signed = data.type === "deposit" ? positive : positive.neg();

  // Optional date-only field: the picked day, or the user's today
  // when left empty. Reject malformed values up front instead of
  // aborting mid-transaction.
  const txnDate = data.date ? parseDateOnly(data.date) : await todayDateOnly();
  if (!txnDate) {
    return { status: "error", errors: { date: ["Invalid date"] } };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const balanceCheck = await adjustTrustBalance(tx, matterId, signed);
      if (!balanceCheck.ok) throw new UserFacingError(balanceCheck.error ?? "Trust update failed.");
      await tx.trustTransaction.create({
        data: {
          matterId,
          type: data.type,
          amount: signed,
          description: data.description,
          reference: data.reference || null,
          date: txnDate,
          createdBy: userId,
        },
      });
    });

    await logActivity({
      matterId,
      userId,
      type: "deposit",
      title:
        data.type === "deposit"
          ? `Trust deposit · $${positive.toFixed(2)}`
          : `Trust ${data.type} · $${positive.toFixed(2)}`,
      detail: data.description,
    });

    revalidatePath(`/matters/${matterId}/billing`);
    revalidatePath(`/matters/${matterId}`);
    revalidatePath("/", "layout");
    return {
      ...billingInitialState,
      status: "ok",
      // Re-using invoiceId to mean "the row that was created" is a
      // tiny abuse of the field; the page doesn't use it for trust
      // txns yet. Leave the field unset.
    };
  } catch (err) {
    return {
      status: "error",
      error: toUserMessage(err, "Couldn't record transaction.", "billing.addTrustTransaction"),
    };
  }
}
