import "server-only";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadFirmProfileForUser } from "@/lib/firm";
import { logActivity } from "@/lib/activity-log";
import { sendEmail } from "@/lib/email/send";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { todayDateOnly } from "@/app/actions/billing/helpers";
import { getInvoiceById } from "@/lib/queries/billing";
import { resolvePortalSendTarget } from "@/lib/queries/portal-billing";
import {
  invoiceEmail,
  portalInvoiceUrl,
  type InvoiceEmailKind,
} from "@/lib/billing/invoice-email";
import { invoicePdfFilename, renderInvoicePdf } from "@/lib/billing/invoice-pdf";
import { fileInvoicePdf } from "@/lib/billing/invoice-filing";

export type DeliveryResult =
  | { ok: true }
  | { ok: false; warning: string; emailSent: boolean };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Render, file and email an invoice, then log activity. Call AFTER the
 * status transaction commits, never inside one. Never throws: failures
 * come back as a warning for the caller to surface.
 */
export async function deliverInvoiceEmail(input: {
  invoiceId: string;
  to: string;
  userId: string;
  kind: InvoiceEmailKind;
}): Promise<DeliveryResult> {
  try {
    return await deliver(input);
  } catch (err) {
    console.warn("[invoice-delivery] unexpected failure", err);
    return {
      ok: false,
      warning: `The email didn't go out: ${message(err)}. Use Re-send email to retry.`,
      emailSent: false,
    };
  }
}

async function deliver(input: {
  invoiceId: string;
  to: string;
  userId: string;
  kind: InvoiceEmailKind;
}): Promise<DeliveryResult> {
  const { invoiceId, to, userId, kind } = input;
  const timeZone = await getCurrentUserTimeZone();
  const invoice = await getInvoiceById(invoiceId, timeZone);
  if (!invoice) {
    return {
      ok: false,
      warning: "The email didn't go out: invoice not found. Use Re-send email to retry.",
      emailSent: false,
    };
  }
  const n = invoice.invoiceNumber;

  // Any failure before the send is logged against the matter and
  // reported as "didn't go out" (spec §5 step 2).
  let firm: NonNullable<Awaited<ReturnType<typeof loadFirmProfileForUser>>>;
  let sender: { email: string } | null;
  let bytes: Buffer;
  try {
    const [f, u] = await Promise.all([
      loadFirmProfileForUser(userId),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);
    if (!f) throw new Error("firm profile missing");
    firm = f;
    sender = u;
    bytes = await renderInvoicePdf(invoice, firm, timeZone);
  } catch (err) {
    const reason = message(err);
    await logActivity({
      matterId: invoice.matterId,
      userId,
      type: "filing",
      title: `Invoice ${n} email failed: ${to}`,
      detail: reason,
    });
    return {
      ok: false,
      warning: `The email didn't go out: ${reason}. Use Re-send email to retry.`,
      emailSent: false,
    };
  }

  // File the PDF first; a filing failure must not block the email.
  let filingFailed = false;
  try {
    const day = await todayDateOnly();
    await fileInvoicePdf({
      matterId: invoice.matterId,
      invoiceNumber: invoice.invoiceNumber,
      kind,
      bytes,
      userId,
      day,
    });
    revalidatePath(`/matters/${invoice.matterId}/documents`);
  } catch (err) {
    filingFailed = true;
    console.warn("[invoice-delivery] filing failed", err);
  }

  let portalUrl: string | null = null;
  try {
    const target = await resolvePortalSendTarget(invoiceId);
    if (target.available) portalUrl = portalInvoiceUrl(invoice.matterId, invoiceId);
  } catch (err) {
    console.warn("[invoice-delivery] portal lookup failed", err);
  }

  const firmName = firm.shortName ?? firm.name;
  const content = invoiceEmail({
    kind,
    invoiceNumber: invoice.invoiceNumber,
    firmName,
    matterName: invoice.matterName,
    balanceDue: invoice.balance,
    dueDate: invoice.dueDate,
    timeZone,
    portalUrl,
  });
  const result = await sendEmail({
    to,
    ...content,
    fromName: firmName,
    ...(sender?.email ? { replyTo: sender.email } : {}),
    attachments: [
      {
        filename: invoicePdfFilename(invoice.invoiceNumber),
        content: bytes,
        contentType: "application/pdf",
      },
    ],
  });

  if (result.ok) {
    await logActivity({
      matterId: invoice.matterId,
      userId,
      type: "filing",
      title: `${kind === "updated" ? "Updated invoice" : "Invoice"} ${n} emailed to ${to}`,
      detail: result.id ? `Resend id ${result.id}` : null,
    });
  } else {
    await logActivity({
      matterId: invoice.matterId,
      userId,
      type: "filing",
      title: `Invoice ${n} email failed: ${to}`,
      detail: result.error,
    });
  }

  const warnings: string[] = [];
  if (!result.ok) {
    warnings.push(`The email didn't go out: ${result.error}. Use Re-send email to retry.`);
  }
  if (filingFailed) {
    warnings.push(
      result.ok
        ? "The invoice was emailed, but a copy couldn't be saved to Documents."
        : "A copy also couldn't be saved to Documents."
    );
  }
  if (warnings.length === 0) return { ok: true };
  return { ok: false, warning: warnings.join(" "), emailSent: result.ok };
}
