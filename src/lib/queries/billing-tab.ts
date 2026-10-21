/**
 * Data loader for the matter Billing tab (`/matters/[id]/billing`):
 * the billing summary, firm letterhead, settlement, every permission
 * flag the tab's controls depend on, and the `?invoice=` selection
 * (validated against this matter). The page authenticates itself
 * (billing.view + matter access) before calling this.
 */

import {
  getMatterBilling,
  getInvoiceById,
  type InvoiceDetail,
} from "@/lib/queries/billing";
import { getUnbilledExpenseSummary } from "@/lib/queries/billing-expenses";
import { getMatterSettlement } from "@/lib/queries/settlements";
import {
  portalSendAvailability,
  type PortalSendAvailability,
} from "@/lib/queries/portal-billing";
import { prisma } from "@/lib/prisma";
import { getCurrentFirm } from "@/lib/firm";
import { getCurrentUserId } from "@/lib/current-user";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { currentUserHasPermission } from "@/lib/permission-check";
import type { BillingPermissions } from "@/components/matters/billing/tab/shared";

export async function loadBillingTab(
  id: string,
  requestedInvoiceId: string | null
) {
  // Gates the entire Settlement card — the waterfall (gross, firm
  // fee, liens, client net) is the most sensitive number set on the
  // matter, so billing-tab access alone isn't enough to see it.
  // Started first so the settlement query below (settlement + liens
  // + approvals) is skipped entirely for viewers who can't see it.
  const canViewSettlementP = currentUserHasPermission(
    "matters.settlement.view"
  );

  const [
    billing,
    firm,
    timeZone,
    unbilledExpenses,
    canViewSettlement,
    settlement,
    canEditSettlement,
    canManageLiens,
    canApproveSettlement,
    canEditAnyTimeEntry,
    canApplyTrust,
    canGenerateInvoice,
    canApproveInvoice,
    canSendInvoice,
    canRecordPayment,
    canVoidInvoice,
    canDeleteDraft,
    canRecordTrustTransaction,
    currentUserId,
    requestedInvoice,
    portalBillingMatter,
  ] = await Promise.all([
    getMatterBilling(id),
    getCurrentFirm(),
    getCurrentUserTimeZone(),
    getUnbilledExpenseSummary(id),
    canViewSettlementP,
    canViewSettlementP.then((ok) => (ok ? getMatterSettlement(id) : null)),
    currentUserHasPermission("matters.settlement.edit"),
    currentUserHasPermission("matters.settlement.manage_liens"),
    currentUserHasPermission("matters.settlement.approve"),
    // Drives the line-item edit pencil on draft/approved
    // invoices for non-author actors. Authors of an entry can
    // always edit their own (per-row check below) — this gates
    // the cross-author path.
    currentUserHasPermission("time_entries.edit_any"),
    // Paying an invoice from trust moves client money: gates the
    // Apply-trust button, the Trust payment method and apply-at-send
    // (the server enforces the same key).
    currentUserHasPermission("billing.apply_trust"),
    // Generate / bundle / line-item edits price the invoice; the
    // server requires this key for all three.
    currentUserHasPermission("billing.generate_invoice"),
    currentUserHasPermission("billing.approve_invoice"),
    currentUserHasPermission("billing.send_invoice"),
    currentUserHasPermission("billing.record_payment"),
    currentUserHasPermission("billing.void_invoice"),
    currentUserHasPermission("billing.delete_draft"),
    currentUserHasPermission("trust.record_transaction"),
    getCurrentUserId(),
    // Fetched in parallel with the rest instead of after it. It is
    // only USED if the invoice belongs to this matter (below), so an
    // id from another matter is read and discarded, never rendered.
    requestedInvoiceId ? getInvoiceById(requestedInvoiceId) : null,
    // Page already asserted matter access and billing.view; this only
    // drives the client-visibility hint on the trust form.
    prisma.matter.findUnique({
      where: { id },
      select: { portalBillingEnabled: true },
    }),
  ]);

  const permissions: BillingPermissions = {
    generateInvoice: canGenerateInvoice,
    approveInvoice: canApproveInvoice,
    sendInvoice: canSendInvoice,
    recordPayment: canRecordPayment,
    applyTrust: canApplyTrust,
    voidInvoice: canVoidInvoice,
    deleteDraft: canDeleteDraft,
    recordTrustTransaction: canRecordTrustTransaction,
  };

  // Validate the requested invoice belongs to this matter — defends
  // against a stale ?invoice= surviving navigation between matters
  // (and against URL-tampering once we go multi-tenant). Both the
  // matter's own invoice list AND the loaded row's matterId must
  // agree.
  const selectedInvoice: InvoiceDetail | null =
    requestedInvoice &&
    requestedInvoice.matterId === id &&
    billing.invoices.some((i) => i.id === requestedInvoice.id)
      ? requestedInvoice
      : null;
  const selectedInvoiceId = selectedInvoice?.id ?? null;
  // Only an approved client invoice can be sent; skip the lookup otherwise.
  const portalSend: PortalSendAvailability | null =
    selectedInvoice &&
    permissions.sendInvoice &&
    selectedInvoice.kind === "client" &&
    selectedInvoice.status === "approved"
      ? await portalSendAvailability(selectedInvoice.id)
      : null;

  return {
    billing,
    firm,
    timeZone,
    unbilledExpenses,
    canViewSettlement,
    settlement,
    canEditSettlement,
    canManageLiens,
    canApproveSettlement,
    canEditAnyTimeEntry,
    currentUserId,
    permissions,
    selectedInvoice,
    selectedInvoiceId,
    portalSend,
    portalBillingEnabled: portalBillingMatter?.portalBillingEnabled ?? false,
  };
}
