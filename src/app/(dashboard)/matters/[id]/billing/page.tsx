/**
 * Matter Detail — Billing tab (v1)
 *
 * Layout:
 *   - **No invoice selected (default):** the page reads top-to-
 *     bottom in a single column — KPI strip, full-width invoices
 *     table, WIP, Trust ledger.
 *   - **Invoice selected (?invoice=<id>):** the entire main column
 *     compresses to a left lane and a sticky preview pane appears
 *     on the right with the letterhead view + action bar. Scrolling
 *     the page moves the left lane while the preview stays put.
 *     Closing the preview (× button or clearing the URL) restores
 *     the full-width single-column layout.
 *
 * The single-column ↔ split toggle reads `?invoice=<id>` so the
 * view is deep-linkable + back-button-honest, matching the email
 * + calendar URL patterns.
 *
 * What's deferred (intentionally — see docs/features/time-and-billing.md):
 *   - Real email delivery of invoices (send is logged-only today)
 *   - Settlement distribution waterfall
 *   - Tax calculation (taxAmount stays 0)
 *   - Aging report (the row's daysUntilDue gets the user 90% there)
 *
 * Permissions: every mutating control is shown only to viewers
 * holding its key (resolved here with currentUserHasPermission) —
 * a denied server action silently redirects to "/", so the UI must
 * not offer what the server will refuse. The server actions still
 * enforce each key.
 *
 * Dates (ADR-012): invoice issue/due dates are instants shown in the
 * viewer's profile zone; expense / payment / trust / time-entry
 * dates are date-only values shown on their stored calendar day.
 */

import Link from "next/link";
import { Printer, X } from "lucide-react";
import { InvoiceActionBar } from "@/components/matters/billing/invoice-action-bar";
import { InvoicePreview } from "@/components/matters/billing/invoice-preview";
import { MainColumn } from "@/components/matters/billing/tab/main-column";
import { loadBillingTab } from "@/lib/queries/billing-tab";
import { requirePermission } from "@/lib/permission-check";
import type { InvoiceKind } from "@/lib/billing-form";
import { assertMatterAccess } from "@/lib/matter-access";

export default async function MatterBillingPage({
  params,
  searchParams,
}: PageProps<"/matters/[id]/billing">) {
  // `billing.view` gates the whole tab (invoices, payments, trust
  // ledger). Without it the viewer is bounced to the dashboard; the
  // tab link is hidden in the layout too.
  await requirePermission("billing.view");
  const { id } = await params;
  await assertMatterAccess(id);
  const sp = await searchParams;
  const rawInvoice = Array.isArray(sp.invoice) ? sp.invoice[0] : sp.invoice;
  const requestedInvoiceId =
    typeof rawInvoice === "string" ? rawInvoice : null;

  const {
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
  } = await loadBillingTab(id, requestedInvoiceId);

  const main = (
    <MainColumn
      matterId={id}
      billing={billing}
      unbilledExpenses={unbilledExpenses}
      permissions={permissions}
      timeZone={timeZone}
      settlement={settlement}
      canViewSettlement={canViewSettlement}
      canEditSettlement={canEditSettlement}
      canManageLiens={canManageLiens}
      canApproveSettlement={canApproveSettlement}
      selectedInvoiceId={selectedInvoiceId}
      isSplit={!!selectedInvoice}
    />
  );

  // Single-column when nothing's selected. Two-column the moment
  // an invoice is selected — the main column compresses, the
  // preview pane lives on the right. The right pane is `sticky` so
  // it stays in view as the user scrolls WIP / Trust on the left.
  if (!selectedInvoice) {
    return <div className="p-3 sm:p-5 flex flex-col gap-5">{main}</div>;
  }

  return (
    <div className="p-3 sm:p-5 flex flex-col xl:flex-row gap-5 xl:items-start">
      <div className="flex-1 min-w-0 flex flex-col gap-5">{main}</div>
      {/* Preview pane is full-width on smaller screens (stacks
          below the main column), 36rem wide and sticky on xl+
          where the viewport has the room. Caps out at the
          viewport height so the doc body still scrolls. */}
      <aside className="w-full xl:w-[36rem] xl:shrink-0 xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] flex flex-col rounded-md border border-line overflow-hidden bg-paper">
        {/* Sticky top bar — stays visible as the document body
            below scrolls. Hosts the invoice label + status-aware
            action buttons + close. The body section is the scroll
            container, so this header naturally sits put. */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-paper-2/60 shrink-0">
          <div className="text-2xs font-medium text-ink-3 mr-auto pl-1">
            Invoice {selectedInvoice.invoiceNumber}
          </div>
          {/* Keyed by invoice: the bar owns dialog open-flags, which
              must not carry over to the next selected invoice. */}
          <InvoiceActionBar
            key={selectedInvoice.id}
            invoiceId={selectedInvoice.id}
            invoiceNumber={selectedInvoice.invoiceNumber}
            currentStatus={selectedInvoice.status}
            kind={selectedInvoice.kind as InvoiceKind}
            invoiceBalance={selectedInvoice.balance}
            trustBalance={billing.trust.balance}
            paidAmount={selectedInvoice.paidAmount}
            clientEmail={selectedInvoice.clientEmail}
            canApplyTrust={permissions.applyTrust}
            portalSend={portalSend ?? undefined}
            canApproveInvoice={permissions.approveInvoice}
            canSendInvoice={permissions.sendInvoice}
            canRecordInvoicePayment={permissions.recordPayment}
            canVoid={permissions.voidInvoice}
            canDeleteDraft={permissions.deleteDraft}
          />
          {/* Print / Save as PDF — opens the print route in a new
              tab with auto-print enabled so the browser dialog
              fires immediately. New tab so the matter page stays
              put behind the print preview. */}
          <a
            href={`/print/invoices/${selectedInvoice.id}?autoprint=1`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Print or save as PDF"
            title="Print or save as PDF"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink"
          >
            <Printer size={14} />
          </a>
          <Link
            href={`/matters/${id}/billing`}
            scroll={false}
            aria-label="Close preview"
            title="Close preview"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink"
          >
            <X size={14} />
          </Link>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <InvoicePreview
            invoice={selectedInvoice}
            firm={firm}
            timeZone={timeZone}
            // Line items are editable only while the invoice is a
            // `draft` (approval signs off on a specific total), and
            // only for users holding billing.generate_invoice.
            editable={
              selectedInvoice.status === "draft" && permissions.generateInvoice
            }
            currentUserId={currentUserId}
            canEditAnyTimeEntry={canEditAnyTimeEntry}
          />
        </div>
      </aside>
    </div>
  );
}
